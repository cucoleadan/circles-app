-- Private results of explicitly requested live SDK reads; never placed in job logs.
create unique index substack_connections_id_user_mcp_idx on substack_connections(id, user_id);
create table mcp_tool_runs (
  id text primary key,
  user_id text not null references app_users(id) on delete cascade,
  connection_id text not null,
  auth_user_id text not null references "user"(id) on delete cascade,
  client_id text not null references "oauthClient"("clientId") on delete cascade,
  token_issued_at bigint not null,
  tool_name text not null,
  arguments jsonb not null,
  required_scopes jsonb not null,
  job_id bigint references jobs(id) on delete set null,
  result jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (connection_id, user_id) references substack_connections(id, user_id) on delete cascade
);
create index mcp_tool_runs_user_created_idx on mcp_tool_runs(user_id, created_at desc);
alter table mcp_tool_runs enable row level security;
alter table mcp_tool_runs force row level security;
create policy mcp_tool_runs_tenant on mcp_tool_runs
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

create table mcp_grant_revocations (
  user_id text not null references app_users(id) on delete cascade,
  client_id text not null references "oauthClient"("clientId") on delete cascade,
  revoked_at timestamptz not null default now(),
  primary key (user_id, client_id)
);
alter table mcp_grant_revocations enable row level security;
alter table mcp_grant_revocations force row level security;
create policy mcp_grant_revocations_tenant on mcp_grant_revocations
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());
