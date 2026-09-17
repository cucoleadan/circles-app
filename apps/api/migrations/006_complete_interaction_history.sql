-- Phase 5.5: complete interaction history, per-stream sync state, and resumable backfill.

alter table interactions
  add column if not exists removed_at timestamptz;

create index if not exists interactions_user_active_direction_idx
  on interactions (user_id, direction, occurred_at desc)
  where removed_at is null;

alter table relationship_stats
  add column if not exists inbound_interaction_count integer not null default 0,
  add column if not exists outbound_interaction_count integer not null default 0,
  add column if not exists outbound_engagement_score integer not null default 0;

with totals as (
  select person_id,
    count(*) filter (where direction = 'inbound')::int as inbound_count,
    count(*) filter (where direction = 'outbound')::int as outbound_count,
    coalesce(sum(case
      when direction = 'inbound' and action_type = 'like' then 1
      when direction = 'inbound' and action_type = 'restack' and (body is null or trim(body) = '') then 2
      when direction = 'inbound' and action_type in ('restack', 'comment', 'reply') then 3
      when direction = 'inbound' then 1 else 0 end), 0)::int as inbound_score,
    coalesce(sum(case
      when direction = 'outbound' and action_type = 'like' then 1
      when direction = 'outbound' and action_type = 'restack' and (body is null or trim(body) = '') then 2
      when direction = 'outbound' and action_type in ('restack', 'comment', 'reply') then 3
      when direction = 'outbound' then 1 else 0 end), 0)::int as outbound_score
  from interactions
  where person_id is not null and removed_at is null
  group by person_id
)
update relationship_stats s
set inbound_interaction_count = totals.inbound_count,
    outbound_interaction_count = totals.outbound_count,
    engagement_score = totals.inbound_score,
    outbound_engagement_score = totals.outbound_score,
    updated_at = now()
from totals
where s.person_id = totals.person_id;

-- Authored posts and Notes are sync seeds. Their replies/comments are normalized
-- into interactions; the source payload remains available for safe reprocessing.
create table owned_content (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  connection_id text not null references substack_connections (id) on delete cascade,
  kind text not null check (kind in ('post', 'note')),
  external_id text not null,
  title text,
  body text,
  url text,
  published_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, kind, external_id)
);

create index owned_content_user_published_idx
  on owned_content (user_id, published_at desc nulls last, id);

-- Each upstream surface advances independently. A successful notification page
-- must never advance the Notes/posts checkpoint, or vice versa.
create table sync_stream_state (
  connection_id text not null references substack_connections (id) on delete cascade,
  user_id text not null references app_users (id) on delete cascade,
  stream text not null check (stream in
    ('activity', 'owned_notes', 'owned_posts', 'outbound_actions')),
  status text not null default 'idle'
    check (status in ('idle', 'running', 'error', 'unavailable')),
  cursor text,
  last_synced_at timestamptz,
  completeness text not null default 'partial'
    check (completeness in ('complete', 'partial', 'unavailable')),
  finish_reason text,
  error text,
  updated_at timestamptz not null default now(),
  primary key (connection_id, stream)
);

create index sync_stream_state_user_idx
  on sync_stream_state (user_id, updated_at desc);

-- One parent import run fans out into independently resumable streams.
create table import_run_streams (
  import_run_id text not null references import_runs (id) on delete cascade,
  user_id text not null references app_users (id) on delete cascade,
  connection_id text not null references substack_connections (id) on delete cascade,
  stream text not null check (stream in
    ('activity', 'owned_notes', 'owned_posts', 'outbound_actions')),
  status text not null default 'running'
    check (status in ('running', 'paused', 'complete', 'failed', 'unavailable')),
  cursor text,
  pages integer not null default 0,
  items integer not null default 0,
  new_interactions integer not null default 0,
  new_people integer not null default 0,
  completeness text not null default 'partial'
    check (completeness in ('complete', 'partial', 'unavailable')),
  finish_reason text,
  error text,
  updated_at timestamptz not null default now(),
  primary key (import_run_id, stream)
);

create index import_run_streams_user_idx
  on import_run_streams (user_id, updated_at desc);

alter table owned_content enable row level security;
create policy owned_content_tenant on owned_content
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table sync_stream_state enable row level security;
create policy sync_stream_state_tenant on sync_stream_state
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table import_run_streams enable row level security;
create policy import_run_streams_tenant on import_run_streams
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());
