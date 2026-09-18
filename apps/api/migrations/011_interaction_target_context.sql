-- Preserve the content an interaction acted on separately from text authored by
-- the actor. This lets a Like show the Note/comment/post that received it.
alter table interactions
  add column if not exists target_body text;

-- Older gateway imports already retained target text in metadata.
update interactions
set target_body = coalesce(
  nullif(metadata->>'targetBody', ''),
  nullif(metadata->>'target_body', '')
)
where target_body is null
  and coalesce(metadata->>'targetBody', metadata->>'target_body', '') <> '';

-- The legacy import and the PostgreSQL replay could preserve the same source
-- event on opposite sides of a connection boundary. Merge only rows proven to
-- be the same event, counterparty, direction, action, and timestamp.
create temporary table interaction_duplicate_pairs on commit drop as
with ranked as (
  select interaction.id,
         first_value(interaction.id) over (
           partition by interaction.user_id, interaction.external_id,
                        interaction.person_id, interaction.direction,
                        interaction.action_type, interaction.occurred_at
           order by (interaction.connection_id is not null) desc,
           (
             (interaction.target_body is not null)::int +
             (interaction.target_title is not null)::int +
             (interaction.target_url is not null)::int
           ) desc,
           interaction.created_at desc,
           interaction.id desc
         ) as winner_id,
         row_number() over (
           partition by interaction.user_id, interaction.external_id,
                        interaction.person_id, interaction.direction,
                        interaction.action_type, interaction.occurred_at
           order by (interaction.connection_id is not null) desc,
           (
             (interaction.target_body is not null)::int +
             (interaction.target_title is not null)::int +
             (interaction.target_url is not null)::int
           ) desc,
           interaction.created_at desc,
           interaction.id desc
         ) as duplicate_rank
  from interactions interaction
  where interaction.removed_at is null and interaction.person_id is not null
)
select id as duplicate_id, winner_id
from ranked
where duplicate_rank > 1;

update interactions winner
set target_body = coalesce(nullif(winner.target_body, ''), nullif(duplicate.target_body, '')),
    target_title = coalesce(nullif(winner.target_title, ''), nullif(duplicate.target_title, '')),
    target_url = coalesce(nullif(winner.target_url, ''), nullif(duplicate.target_url, '')),
    body = coalesce(nullif(winner.body, ''), nullif(duplicate.body, '')),
    metadata = duplicate.metadata || winner.metadata
from interaction_duplicate_pairs pair
join interactions duplicate on duplicate.id = pair.duplicate_id
where winner.id = pair.winner_id;

update interactions duplicate
set removed_at = now(),
    metadata = duplicate.metadata || jsonb_build_object(
      'deduplicatedInto', pair.winner_id,
      'deduplicatedReason', 'same_source_event_and_counterparty'
    )
from interaction_duplicate_pairs pair
where duplicate.id = pair.duplicate_id;

-- Active Likes and restacks are stateful actions. Keep one active row for the
-- same person and target even if it arrived through a new connection generation.
create temporary table canonical_action_duplicate_pairs on commit drop as
with ranked as (
  select interaction.id,
         first_value(interaction.id) over (
           partition by interaction.user_id, interaction.person_id,
                        interaction.direction, interaction.action_type,
                        interaction.target_type, interaction.target_id
           order by (interaction.connection_id is not null) desc,
           (
             (interaction.target_body is not null)::int +
             (interaction.target_title is not null)::int +
             (interaction.target_url is not null)::int
           ) desc,
           interaction.occurred_at desc,
           interaction.created_at desc,
           interaction.id desc
         ) as winner_id,
         row_number() over (
           partition by interaction.user_id, interaction.person_id,
                        interaction.direction, interaction.action_type,
                        interaction.target_type, interaction.target_id
           order by (interaction.connection_id is not null) desc,
           (
             (interaction.target_body is not null)::int +
             (interaction.target_title is not null)::int +
             (interaction.target_url is not null)::int
           ) desc,
           interaction.occurred_at desc,
           interaction.created_at desc,
           interaction.id desc
         ) as duplicate_rank
  from interactions interaction
  where interaction.removed_at is null
    and interaction.person_id is not null
    and interaction.target_id is not null
    and interaction.action_type in ('like', 'restack')
)
select id as duplicate_id, winner_id
from ranked
where duplicate_rank > 1;

update interactions winner
set target_body = coalesce(nullif(winner.target_body, ''), nullif(duplicate.target_body, '')),
    target_title = coalesce(nullif(winner.target_title, ''), nullif(duplicate.target_title, '')),
    target_url = coalesce(nullif(winner.target_url, ''), nullif(duplicate.target_url, '')),
    metadata = duplicate.metadata || winner.metadata
from canonical_action_duplicate_pairs pair
join interactions duplicate on duplicate.id = pair.duplicate_id
where winner.id = pair.winner_id;

update interactions duplicate
set removed_at = now(),
    metadata = duplicate.metadata || jsonb_build_object(
      'deduplicatedInto', pair.winner_id,
      'deduplicatedReason', 'same_active_action_target'
    )
from canonical_action_duplicate_pairs pair
where duplicate.id = pair.duplicate_id;

create unique index if not exists interactions_active_action_target_idx
  on interactions (user_id, person_id, direction, action_type, target_type, target_id)
  where removed_at is null
    and person_id is not null
    and target_id is not null
    and action_type in ('like', 'restack');

-- Recalculate cached relationship totals after removing duplicate active rows.
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
where interaction.removed_at is null and interaction.person_id is not null
group by interaction.person_id, interaction.user_id
on conflict (person_id) do update
set interaction_count = excluded.interaction_count,
    conversation_count = excluded.conversation_count,
    first_interacted_at = excluded.first_interacted_at,
    last_interaction_at = excluded.last_interaction_at,
    last_inbound_at = excluded.last_inbound_at,
    last_outbound_at = excluded.last_outbound_at,
    last_conversation_at = excluded.last_conversation_at,
    drift_status = excluded.drift_status,
    engagement_score = excluded.engagement_score,
    inbound_interaction_count = excluded.inbound_interaction_count,
    outbound_interaction_count = excluded.outbound_interaction_count,
    outbound_engagement_score = excluded.outbound_engagement_score,
    updated_at = now();

update relationship_stats stats
set interaction_count = 0, conversation_count = 0, engagement_score = 0,
    inbound_interaction_count = 0, outbound_interaction_count = 0,
    outbound_engagement_score = 0, first_interacted_at = null,
    last_interaction_at = null, last_inbound_at = null, last_outbound_at = null,
    last_conversation_at = null, drift_status = 'new', updated_at = now()
where not exists (
  select 1 from interactions interaction
  where interaction.person_id = stats.person_id and interaction.removed_at is null
);

-- Replay retained snapshots/batches through the updated normalizers. The job is
-- database-only and does not add Substack requests during normal browsing.
insert into jobs (type, payload, status, run_at)
select 'reprocess:interaction-evidence',
       json_build_object('userId', connection.user_id, 'connectionId', connection.id),
       'pending', now()
from substack_connections connection
where connection.status = 'active';
