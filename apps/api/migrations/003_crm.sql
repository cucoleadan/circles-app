-- Phase 2: full CRM schema per plan section 7 (D1 mapping).
-- Port the Phase 1 placeholder `contacts` into `people`, then build out the
-- complete tenant-owned model with row level security for the circles_app role.

-- CRM ownership, distinct from the Better Auth `user` table. `id` preserves the
-- legacy app user ID at import; fresh rows use generated UUIDs.
create table app_users (
  id text primary key,
  auth_user_id text not null unique references "user" (id) on delete cascade,
  extension_installed_at timestamptz,
  legacy_clerk_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table people (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  name text not null,
  handle text,
  normalized_handle text,
  profile_url text,
  publication_url text,
  substack_profile_id text,
  relationship_status text
    check (relationship_status in
      ('new', 'reach-out', 'contacted', 'conversation', 'active', 'archived')),
  notes text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, user_id)
);

-- Port any Phase 1 placeholder contacts into `people` (guarded so the
-- migration also applies to databases where the placeholder is already gone).
do $port$
begin
  if to_regclass('public.contacts') is not null then
    insert into app_users (id, auth_user_id)
    select distinct user_id, user_id from contacts
    on conflict do nothing;

    insert into people (id, user_id, name, handle, normalized_handle,
                        relationship_status, notes, source, created_at, updated_at)
    select id, user_id, name, handle, lower(handle),
           case relationship_status
             when 'close' then 'active'
             when 'dormant' then 'archived'
             else relationship_status
           end,
           notes, 'manual', created_at, updated_at
    from contacts;

    drop table contacts;
  end if;
end
$port$;

create unique index people_user_handle_idx
  on people (user_id, normalized_handle)
  where handle is not null and archived_at is null;
create index people_user_name_idx on people (user_id, lower(name), id);
create index people_user_status_idx
  on people (user_id, relationship_status)
  where archived_at is null;

-- Rebuildable per-person totals and conversation timestamps so overview
-- requests never scan the interaction archive. AI summaries are derived data.
create table relationship_stats (
  person_id text primary key,
  user_id text not null,
  interaction_count integer not null default 0,
  conversation_count integer not null default 0,
  first_interacted_at timestamptz,
  last_interaction_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_conversation_at timestamptz,
  drift_status text not null default 'new'
    check (drift_status in ('new', 'active', 'drifting', 'cold')),
  ai_summary text,
  ai_suggested_action text,
  ai_topics jsonb,
  ai_summarized_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (person_id, user_id) references people (id, user_id) on delete cascade
);

create index relationship_stats_user_recency_idx
  on relationship_stats (user_id, last_interaction_at desc nulls last);
create index relationship_stats_user_drift_idx
  on relationship_stats (user_id, drift_status);

create table tags (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  color text not null default '#635bff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, normalized_name)
);

-- Membership edges carry user_id so composite FKs make cross-tenant attachment
-- impossible at the database level, even if an application check is missed.
create table person_tags (
  person_id text not null,
  tag_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (person_id, tag_id),
  foreign key (person_id, user_id) references people (id, user_id) on delete cascade,
  foreign key (tag_id, user_id) references tags (id, user_id) on delete cascade
);

create index person_tags_tag_idx on person_tags (tag_id, user_id);

create table lists (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, normalized_name)
);

create table list_members (
  list_id text not null,
  person_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (list_id, person_id),
  foreign key (list_id, user_id) references lists (id, user_id) on delete cascade,
  foreign key (person_id, user_id) references people (id, user_id) on delete cascade
);

create index list_members_person_idx on list_members (person_id, user_id);

create table saved_views (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  tag_id text,
  list_id text,
  created_at timestamptz not null default now(),
  check ((tag_id is null) <> (list_id is null)),
  unique (user_id, tag_id),
  unique (user_id, list_id),
  foreign key (tag_id, user_id) references tags (id, user_id) on delete cascade,
  foreign key (list_id, user_id) references lists (id, user_id) on delete cascade
);

-- Encrypted Substack session envelopes. Multiple generations per user are
-- retained so reconnecting a different identity never relabels old history;
-- only one row per user may be active at a time.
create table substack_connections (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  generation integer not null default 1,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired')),
  publication_url text,
  envelope_version integer not null check (envelope_version = 1),
  key_id text not null,
  wrapped_key text not null,
  iv text not null,
  ciphertext text not null,
  profile_id text,
  profile_name text,
  profile_handle text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, generation)
);

create unique index substack_connections_one_active_idx
  on substack_connections (user_id)
  where status = 'active';

-- All inbound/outbound touchpoints with provenance. `thread_kind` keeps post
-- and note thread namespaces distinct. History is preserved even if the
-- person row goes away (person_id on delete set null, mirroring D1).
-- person_id keeps the D1 semantics: deleting a person preserves the history
-- row (set null) rather than erasing evidence.
create table interactions (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  connection_id text references substack_connections (id) on delete set null,
  person_id text references people (id) on delete set null,
  external_id text not null,
  source text not null default 'extension'
    check (source in ('extension', 'sdk', 'import')),
  direction text not null check (direction in ('inbound', 'outbound')),
  action_type text not null check (action_type in
    ('comment', 'reply', 'like', 'restack', 'subscribe', 'mention', 'other')),
  target_type text check (target_type in ('post', 'note', 'comment', 'profile')),
  target_id text,
  target_title text,
  target_url text,
  thread_kind text check (thread_kind in ('post', 'note')),
  thread_root_id text,
  body text,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index interactions_user_external_idx
  on interactions (user_id, external_id)
  where connection_id is null;
create unique index interactions_account_external_idx
  on interactions (connection_id, external_id)
  where connection_id is not null;
create index interactions_user_person_idx
  on interactions (user_id, person_id, occurred_at desc, id desc);
create index interactions_user_thread_idx
  on interactions (user_id, thread_kind, thread_root_id, occurred_at);
create index interactions_user_occurred_idx
  on interactions (user_id, occurred_at desc, id desc);

-- Profile/context capture evidence (plan section 7: no content feed rebuild).
create table profile_snapshots (
  person_id text primary key,
  user_id text not null,
  connection_id text references substack_connections (id) on delete cascade,
  schema_version integer not null,
  payload jsonb,
  fetched_at timestamptz,
  last_attempted_at timestamptz not null default now(),
  last_error text,
  foreign key (person_id, user_id) references people (id, user_id) on delete cascade
);

create table thread_snapshots (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  connection_id text references substack_connections (id) on delete cascade,
  thread_kind text not null check (thread_kind in ('post', 'note')),
  thread_root_id text not null,
  complete boolean not null default false,
  payload jsonb,
  fetched_at timestamptz not null default now(),
  unique (user_id, thread_kind, thread_root_id)
);

create table activity_snapshots (
  connection_id text primary key
    references substack_connections (id) on delete cascade,
  schema_version integer not null,
  payload jsonb not null,
  captured_at timestamptz not null default now()
);

create table note_replies_snapshots (
  connection_id text not null
    references substack_connections (id) on delete cascade,
  note_id text not null,
  schema_version integer not null,
  payload jsonb not null,
  captured_at timestamptz not null default now(),
  primary key (connection_id, note_id)
);

-- Incremental sync cursor per connection (leases are never imported).
create table sync_state (
  connection_id text primary key
    references substack_connections (id) on delete cascade,
  user_id text not null references app_users (id) on delete cascade,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'paused', 'error')),
  cursor text,
  last_synced_at timestamptz,
  next_run_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token text,
  error text,
  updated_at timestamptz not null default now()
);

-- Historical import runs, resumable via checkpoint columns (from
-- community_activity_backfills). One row per run so history is kept.
create table import_runs (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  connection_id text not null
    references substack_connections (id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'paused', 'complete', 'failed')),
  started_at timestamptz not null default now(),
  cutoff timestamptz not null,
  after_cursor text,
  oldest_at timestamptz,
  finish_reason text,
  pages integer not null default 0,
  items integer not null default 0,
  new_interactions integer not null default 0,
  enriched_interactions integer not null default 0,
  new_people integer not null default 0,
  next_request_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token text,
  pending jsonb,
  error text
);

create index import_runs_user_idx on import_runs (user_id, started_at desc);

-- Durable capture acknowledgments: the extension POSTs a batch, it is stored
-- here and acknowledged, then processed asynchronously with dedupe.
create table ingestion_batches (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  source text not null default 'extension',
  dedupe_key text not null,
  payload jsonb not null,
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed', 'rejected')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (user_id, dedupe_key)
);

-- Queue with lease-token fencing, heartbeats and terminal states. Rebuilt from
-- the Phase 1 placeholder (table was empty).
drop table if exists jobs;

create table jobs (
  id bigserial primary key,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'dead')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  locked_by text,
  lease_token text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_due_idx on jobs (status, run_at, id);
create index jobs_lease_idx on jobs (lease_expires_at) where status = 'running';

-- Minimal audit trail for sensitive account/CRM mutations.
create table audit_log (
  id bigserial primary key,
  user_id text not null references app_users (id) on delete cascade,
  action text not null,
  subject_type text,
  subject_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_user_idx on audit_log (user_id, created_at desc);

grant usage on sequence jobs_id_seq, audit_log_id_seq to circles_app;

-- Row level security: the runtime role (circles_app, non-owner) only sees rows
-- belonging to the tenant set transaction-locally via `set local app.user_id`.
-- circles_migrate (owner) still bypasses RLS, which the D1 import relies on.

create or replace function app_tenant_id() returns text
  language sql stable as $$
    select nullif(current_setting('app.user_id', true), '')
  $$;

-- The auth-user clause exists only so the API can resolve a verified session to
-- its app user row; every other table is scoped by app_tenant_id() alone.
alter table app_users enable row level security;
create policy app_users_tenant on app_users
  using (
    id = app_tenant_id()
    or auth_user_id = nullif(current_setting('app.auth_user_id', true), '')
  )
  with check (
    id = app_tenant_id()
    or auth_user_id = nullif(current_setting('app.auth_user_id', true), '')
  );

alter table people enable row level security;
create policy people_tenant on people
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table relationship_stats enable row level security;
create policy relationship_stats_tenant on relationship_stats
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table tags enable row level security;
create policy tags_tenant on tags
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table person_tags enable row level security;
create policy person_tags_tenant on person_tags
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table lists enable row level security;
create policy lists_tenant on lists
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table list_members enable row level security;
create policy list_members_tenant on list_members
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table saved_views enable row level security;
create policy saved_views_tenant on saved_views
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table substack_connections enable row level security;
create policy substack_connections_tenant on substack_connections
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table interactions enable row level security;
create policy interactions_tenant on interactions
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table profile_snapshots enable row level security;
create policy profile_snapshots_tenant on profile_snapshots
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table thread_snapshots enable row level security;
create policy thread_snapshots_tenant on thread_snapshots
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table activity_snapshots enable row level security;
create policy activity_snapshots_tenant on activity_snapshots
  using (connection_id in (select id from substack_connections))
  with check (connection_id in (select id from substack_connections));

alter table note_replies_snapshots enable row level security;
create policy note_replies_snapshots_tenant on note_replies_snapshots
  using (connection_id in (select id from substack_connections))
  with check (connection_id in (select id from substack_connections));

alter table sync_state enable row level security;
create policy sync_state_tenant on sync_state
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table import_runs enable row level security;
create policy import_runs_tenant on import_runs
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table ingestion_batches enable row level security;
create policy ingestion_batches_tenant on ingestion_batches
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table audit_log enable row level security;
create policy audit_log_tenant on audit_log
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());
