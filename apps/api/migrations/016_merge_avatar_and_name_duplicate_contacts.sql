-- Migration 016: Merge duplicate contacts by Name, Handle, Avatar URL, and Substack Profile ID

create temporary table proven_avatar_and_name_duplicates on commit drop as
with candidate_pairs as (
  select distinct on (p2.id)
    p1.user_id,
    p1.id as canonical_id,
    p2.id as duplicate_id,
    coalesce(p1.substack_profile_id, p2.substack_profile_id) as target_profile_id,
    case
      when p1.avatar_url is not null and p1.avatar_url = p2.avatar_url then 'name_and_avatar_match'
      else 'name_and_identity_match'
    end as reason
  from people p1
  join people p2
    on p2.user_id = p1.user_id
   and p2.id <> p1.id
   and p2.archived_at is null
   and p1.archived_at is null
   and lower(trim(p1.name)) = lower(trim(p2.name))
   and p1.name is not null
   and length(trim(p1.name)) >= 2
   and (
     -- Condition A: One has handle and one does not (handle-based canonical)
     (p1.normalized_handle is not null and p2.normalized_handle is null and p2.substack_profile_id is not null)
     -- Condition B: Both have same avatar and one has handle
     or (p1.avatar_url is not null and p1.avatar_url = p2.avatar_url and p1.normalized_handle is not null and p2.normalized_handle is null)
     -- Condition C: Both have same avatar and p1 is older
     or (p1.avatar_url is not null and p1.avatar_url = p2.avatar_url and p1.created_at <= p2.created_at and p2.id > p1.id)
   )
  order by p2.id,
           (case when p1.normalized_handle is not null then 1 else 0 end) desc,
           (case when p1.substack_profile_id is not null then 1 else 0 end) desc,
           p1.created_at asc,
           p1.id asc
)
select * from candidate_pairs;

-- 1. Merge person tags
insert into person_tags (person_id, tag_id, user_id, created_at)
select pair.canonical_id, membership.tag_id, membership.user_id, membership.created_at
from proven_avatar_and_name_duplicates pair
join person_tags membership on membership.person_id = pair.duplicate_id
on conflict (person_id, tag_id) do nothing;

delete from person_tags membership
using proven_avatar_and_name_duplicates pair
where membership.person_id = pair.duplicate_id;

-- 2. Merge list memberships
insert into list_members (list_id, person_id, user_id, created_at)
select membership.list_id, pair.canonical_id, membership.user_id, membership.created_at
from proven_avatar_and_name_duplicates pair
join list_members membership on membership.person_id = pair.duplicate_id
on conflict (list_id, person_id) do nothing;

delete from list_members membership
using proven_avatar_and_name_duplicates pair
where membership.person_id = pair.duplicate_id;

-- 3. Re-point interactions
update interactions interaction
set person_id = pair.canonical_id
from proven_avatar_and_name_duplicates pair
where interaction.person_id = pair.duplicate_id
  and interaction.user_id = pair.user_id;

-- 4. Re-point snapshots
update profile_snapshots snapshot
set person_id = pair.canonical_id
from proven_avatar_and_name_duplicates pair
where snapshot.person_id = pair.duplicate_id
  and not exists (
    select 1 from profile_snapshots existing
    where existing.person_id = pair.canonical_id
  );

delete from profile_snapshots snapshot
using proven_avatar_and_name_duplicates pair
where snapshot.person_id = pair.duplicate_id;

-- 5. Delete relationship_stats to rebuild fresh
delete from relationship_stats stats
using proven_avatar_and_name_duplicates pair
where stats.person_id in (pair.canonical_id, pair.duplicate_id);

-- 6. FIRST release unique constraints by clearing fields on duplicate and archiving it
update people duplicate
set substack_profile_id = null,
    handle = null,
    normalized_handle = null,
    archived_at = coalesce(duplicate.archived_at, now()),
    updated_at = now()
from proven_avatar_and_name_duplicates pair
where duplicate.id = pair.duplicate_id
  and duplicate.user_id = pair.user_id;

-- 7. THEN update canonical profile metadata and merge audience flags
update people canonical
set substack_profile_id = coalesce(canonical.substack_profile_id, pair.target_profile_id),
    avatar_url = coalesce(canonical.avatar_url, duplicate.avatar_url),
    profile_url = coalesce(canonical.profile_url, duplicate.profile_url),
    publication_url = coalesce(canonical.publication_url, duplicate.publication_url),
    is_follower = (canonical.is_follower or duplicate.is_follower),
    is_subscriber = (canonical.is_subscriber or duplicate.is_subscriber),
    subscribed_at = coalesce(canonical.subscribed_at, duplicate.subscribed_at),
    subscription_tier = coalesce(canonical.subscription_tier, duplicate.subscription_tier),
    updated_at = now()
from proven_avatar_and_name_duplicates pair
join people duplicate on duplicate.id = pair.duplicate_id
where canonical.id = pair.canonical_id
  and canonical.user_id = pair.user_id;

-- 8. Rebuild relationship_stats for canonical contacts
insert into relationship_stats
  (person_id, user_id, interaction_count, conversation_count,
   first_interacted_at, last_interaction_at, last_inbound_at, last_outbound_at,
   last_conversation_at, drift_status, engagement_score,
   inbound_interaction_count, outbound_interaction_count,
   outbound_engagement_score, updated_at)
select interaction.person_id, interaction.user_id, count(*),
  count(distinct interaction.thread_root_id) filter
    (where interaction.thread_root_id is not null and interaction.action_type in ('comment', 'reply')),
  min(interaction.occurred_at), max(interaction.occurred_at),
  max(interaction.occurred_at) filter (where interaction.direction = 'inbound'),
  max(interaction.occurred_at) filter (where interaction.direction = 'outbound'),
  max(interaction.occurred_at) filter (where interaction.thread_root_id is not null),
  case
    when max(interaction.occurred_at) > now() - interval '30 days' then 'active'
    when max(interaction.occurred_at) > now() - interval '90 days' then 'drifting'
    else 'cold'
  end,
  coalesce(sum(case
    when interaction.direction = 'inbound' and interaction.action_type = 'like' then 1
    when interaction.direction = 'inbound' and interaction.action_type = 'restack'
      and (interaction.body is null or trim(interaction.body) = '') then 2
    when interaction.direction = 'inbound' and interaction.action_type in ('restack', 'comment', 'reply') then 3
    when interaction.direction = 'inbound' then 1 else 0 end), 0)::int,
  count(*) filter (where interaction.direction = 'inbound')::int,
  count(*) filter (where interaction.direction = 'outbound')::int,
  coalesce(sum(case
    when interaction.direction = 'outbound' and interaction.action_type = 'like' then 1
    when interaction.direction = 'outbound' and interaction.action_type = 'restack'
      and (interaction.body is null or trim(interaction.body) = '') then 2
    when interaction.direction = 'outbound' and interaction.action_type in ('restack', 'comment', 'reply') then 3
    when interaction.direction = 'outbound' then 1 else 0 end), 0)::int,
  now()
from interactions interaction
join proven_avatar_and_name_duplicates pair on pair.canonical_id = interaction.person_id
where interaction.removed_at is null
group by interaction.person_id, interaction.user_id;

-- 9. Record in audit_log
insert into audit_log (user_id, action, subject_type, subject_id, metadata)
select pair.user_id, 'person.identity_merged', 'person', pair.canonical_id,
       jsonb_build_object(
         'duplicatePersonId', pair.duplicate_id,
         'targetProfileId', pair.target_profile_id,
         'reason', pair.reason
       )
from proven_avatar_and_name_duplicates pair;
