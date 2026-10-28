-- Newsletter Signals list subscribers by email only, while contacts are keyed
-- by Substack profile ID. The subscriber-stats sweep already returns each
-- subscriber's email next to that ID, so keep just the pair to link a
-- subscriber's opens to their contact. Like the signals tables, it is
-- browser-only personal data.
create table subscriber_emails (
  user_id text not null references app_users(id) on delete cascade,
  email text not null,
  substack_profile_id text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, email)
);

alter table subscriber_emails enable row level security;
alter table subscriber_emails force row level security;
create policy subscriber_emails_tenant on subscriber_emails
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

-- One full subscriber sweep fills the pairs for existing subscribers.
insert into jobs (type, payload, status, run_at)
select 'sync:subscribers',
       jsonb_build_object('userId', connection.user_id, 'connectionId', connection.id,
                          'offset', 0, 'runStartedAt', now()),
       'pending', now() + interval '2 minutes'
from substack_connections connection
where connection.status = 'active'
  and not exists (
    select 1
    from jobs existing
    where existing.type = 'sync:subscribers'
      and existing.status in ('pending', 'running')
      and existing.payload->>'connectionId' = connection.id
  );
