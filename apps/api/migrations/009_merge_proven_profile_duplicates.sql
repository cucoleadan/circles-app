-- Older imports could create a handle-only contact before profile IDs were
-- retained. Later ID-only reply history could then create a second contact.
-- Merge only pairs proven by retained interaction evidence containing both the
-- handle and the exact Substack profile ID; never merge on display name alone.
create temporary table proven_profile_duplicates on commit drop as
select distinct on (profile_person.id)
       handle_person.user_id,
       handle_person.id as canonical_id,
       profile_person.id as duplicate_id,
       profile_person.substack_profile_id
from people handle_person
join people profile_person
  on profile_person.user_id = handle_person.user_id
 and profile_person.id <> handle_person.id
 and profile_person.archived_at is null
 and profile_person.substack_profile_id is not null
where handle_person.archived_at is null
  and handle_person.normalized_handle is not null
  and handle_person.substack_profile_id is null
  and exists (
    select 1
    from interactions evidence
    where evidence.user_id = handle_person.user_id
      and evidence.person_id = handle_person.id
      and coalesce(
        evidence.metadata->'actor'->>'id',
        evidence.metadata->'targetAuthor'->>'id',
        evidence.metadata->'target_author'->>'id',
        evidence.metadata->>'actor_id',
        evidence.metadata->>'user_id'
      ) = profile_person.substack_profile_id
      and lower(trim(leading '@' from coalesce(
        evidence.metadata->'actor'->>'handle',
        evidence.metadata->'targetAuthor'->>'handle',
        evidence.metadata->'target_author'->>'handle',
        evidence.metadata->>'actor_handle'
      ))) = handle_person.normalized_handle
  )
order by profile_person.id, handle_person.created_at, handle_person.id;

insert into person_tags (person_id, tag_id, user_id, created_at)
select pair.canonical_id, membership.tag_id, membership.user_id, membership.created_at
from proven_profile_duplicates pair
join person_tags membership on membership.person_id = pair.duplicate_id
on conflict (person_id, tag_id) do nothing;

insert into list_members (list_id, person_id, user_id, created_at)
select membership.list_id, pair.canonical_id, membership.user_id, membership.created_at
from proven_profile_duplicates pair
join list_members membership on membership.person_id = pair.duplicate_id
on conflict (list_id, person_id) do nothing;

update interactions interaction
set person_id = pair.canonical_id
from proven_profile_duplicates pair
where interaction.person_id = pair.duplicate_id
  and interaction.user_id = pair.user_id;

update profile_snapshots snapshot
set person_id = pair.canonical_id
from proven_profile_duplicates pair
where snapshot.person_id = pair.duplicate_id
  and not exists (
    select 1 from profile_snapshots existing
    where existing.person_id = pair.canonical_id
  );

delete from profile_snapshots snapshot
using proven_profile_duplicates pair
where snapshot.person_id = pair.duplicate_id;

delete from relationship_stats stats
using proven_profile_duplicates pair
where stats.person_id in (pair.canonical_id, pair.duplicate_id);

-- Release the partial unique profile-ID index before assigning the stable ID
-- to the established handle contact. Keep the duplicate archived for recovery.
update people duplicate
set substack_profile_id = null,
    handle = null,
    normalized_handle = null,
    archived_at = coalesce(duplicate.archived_at, now()),
    updated_at = now()
from proven_profile_duplicates pair
where duplicate.id = pair.duplicate_id
  and duplicate.user_id = pair.user_id;

update people canonical
set substack_profile_id = pair.substack_profile_id,
    profile_url = coalesce(canonical.profile_url, duplicate.profile_url),
    publication_url = coalesce(canonical.publication_url, duplicate.publication_url),
    updated_at = now()
from proven_profile_duplicates pair
join people duplicate on duplicate.id = pair.duplicate_id
where canonical.id = pair.canonical_id
  and canonical.user_id = pair.user_id;

delete from person_tags membership
using proven_profile_duplicates pair
where membership.person_id = pair.duplicate_id;

delete from list_members membership
using proven_profile_duplicates pair
where membership.person_id = pair.duplicate_id;

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
join proven_profile_duplicates pair on pair.canonical_id = interaction.person_id
where interaction.removed_at is null
group by interaction.person_id, interaction.user_id;

insert into audit_log (user_id, action, subject_type, subject_id, metadata)
select pair.user_id, 'person.identity_merged', 'person', pair.canonical_id,
       jsonb_build_object(
         'duplicatePersonId', pair.duplicate_id,
         'substackProfileId', pair.substack_profile_id,
         'reason', 'retained_profile_id_and_handle_match'
       )
from proven_profile_duplicates pair;
