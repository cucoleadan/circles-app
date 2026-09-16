create table contacts (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  name text not null,
  handle text,
  notes text,
  relationship_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index contacts_user_name_idx on contacts (user_id, lower(name), id);
create unique index contacts_user_handle_idx
  on contacts (user_id, lower(handle))
  where handle is not null and archived_at is null;

create table jobs (
  id bigserial primary key,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now()
);

create index jobs_due_idx on jobs (status, run_at, id);
