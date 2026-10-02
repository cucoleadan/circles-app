-- Note scheduling. Substack owns every draft and publishes scheduled drafts at
-- trigger_at itself; this table mirrors the account's Note drafts so the CRM can
-- show them without an upstream read, remembers Notes after they publish (a
-- published Note keeps its draft ID, which is also its owned_content
-- external_id), and makes create requests idempotent.
create table scheduled_notes (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  connection_id text not null references substack_connections (id) on delete cascade,
  substack_draft_id text,
  status text not null check (status in (
    'pending',    -- create request in flight; no upstream draft ID yet
    'draft',      -- unscheduled Substack draft
    'scheduled',  -- Substack draft with trigger_at
    'published',  -- left the draft list at or after trigger_at, or found in owned_content
    'deleted'     -- deleted from Circles or removed in Substack before publishing
  )),
  origin text not null default 'circles' check (origin in ('circles', 'substack')),
  body_text text not null default '',
  body_json jsonb,
  attachments jsonb not null default '[]'::jsonb,
  reply_minimum_role text,
  trigger_at timestamptz,
  -- "Post now" schedules about a minute ahead so the user can still abort.
  post_now boolean not null default false,
  client_request_id text,
  published_at timestamptz,
  raw jsonb,
  last_seen_upstream_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'pending' or substack_draft_id is not null),
  unique (connection_id, substack_draft_id),
  unique (user_id, client_request_id)
);

create index scheduled_notes_user_status_idx
  on scheduled_notes (user_id, status, trigger_at);

alter table scheduled_notes enable row level security;
create policy scheduled_notes_tenant on scheduled_notes
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

-- Throttles the live draft-list read that refreshes the mirror.
alter table substack_connections
  add column if not exists drafts_reconciled_at timestamptz;
