-- Newsletter Signals: per-post and per-subscriber email engagement computed from
-- the Substack publication export, requested only when the user clicks the
-- button. Each run replaces the previous snapshot. Only email, plan and
-- delivery/open counts are kept; open locations, devices, user agents and the
-- export file itself are discarded.
create table newsletter_export_runs (
  id text primary key,
  user_id text not null references app_users(id) on delete cascade,
  connection_id text not null,
  substack_export_id text,
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  stage text,
  error text,
  posts integer,
  subscribers integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (connection_id, user_id) references substack_connections(id, user_id) on delete cascade
);
create unique index newsletter_export_runs_one_running_idx
  on newsletter_export_runs(user_id) where status = 'running';
create index newsletter_export_runs_user_created_idx on newsletter_export_runs(user_id, created_at desc);

create table newsletter_post_signals (
  user_id text not null references app_users(id) on delete cascade,
  connection_id text not null,
  post_id bigint not null,
  title text,
  slug text,
  audience text,
  sent_at timestamptz,
  delivered integer not null,
  opened integer not null,
  primary key (user_id, connection_id, post_id),
  foreign key (connection_id, user_id) references substack_connections(id, user_id) on delete cascade
);

create table newsletter_subscriber_signals (
  user_id text not null references app_users(id) on delete cascade,
  connection_id text not null,
  email text not null,
  in_email_list boolean not null,
  active_subscription boolean,
  plan text,
  subscribed_at timestamptz,
  delivered integer not null,
  opened integer not null,
  last_opened_at timestamptz,
  last_delivered_at timestamptz,
  -- Sends delivered after the last open; "going cold" is a threshold on this.
  sends_since_open integer not null,
  primary key (user_id, connection_id, email),
  foreign key (connection_id, user_id) references substack_connections(id, user_id) on delete cascade
);

alter table newsletter_export_runs enable row level security;
alter table newsletter_export_runs force row level security;
create policy newsletter_export_runs_tenant on newsletter_export_runs
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());
alter table newsletter_post_signals enable row level security;
alter table newsletter_post_signals force row level security;
create policy newsletter_post_signals_tenant on newsletter_post_signals
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());
alter table newsletter_subscriber_signals enable row level security;
alter table newsletter_subscriber_signals force row level security;
create policy newsletter_subscriber_signals_tenant on newsletter_subscriber_signals
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());
