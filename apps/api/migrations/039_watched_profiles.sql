-- Watched Profiles: a built-in list whose members get their Notes and posts
-- kept fresh by the worker, so agents read a stored copy instead of asking
-- Substack for each person. lists.system_key marks a built-in list (it cannot
-- be renamed or deleted); every tenant gets one 'watched' list.
-- profile_content holds other people's Notes, restacks and posts, keyed by
-- Substack profile ID and linked to the CRM contact when one exists. It is
-- filled by the scheduled 'sync:watched' job, by the publication's public RSS
-- feed (posts) and by profile-feed reads agents request on demand.
-- profile_content_state is the per-profile fetch checkpoint.
alter table lists add column system_key text;
create unique index lists_user_system_key_idx on lists (user_id, system_key)
  where system_key is not null;

-- A list already named "Watched Profiles" becomes the built-in one.
update lists set system_key = 'watched' where normalized_name = 'watched profiles';
insert into lists (id, user_id, name, normalized_name, description, system_key)
select gen_random_uuid()::text, u.id, 'Watched Profiles', 'watched profiles',
  'Circles keeps the Notes and posts of these contacts fresh.', 'watched'
from app_users u
where not exists (
  select 1 from lists l where l.user_id = u.id and l.system_key = 'watched'
);

create table profile_content (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  substack_profile_id text not null,
  -- The CRM contact with this profile ID, when there is one.
  person_id text,
  kind text not null check (kind in ('note', 'reply', 'restack', 'post')),
  external_id text not null,
  title text,
  body text,
  url text,
  published_at timestamptz,
  source text not null check (source in ('watched', 'agent', 'rss')),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, substack_profile_id, kind, external_id),
  foreign key (person_id, user_id) references people (id, user_id)
    on delete set null (person_id)
);
create index profile_content_profile_published_idx
  on profile_content (user_id, substack_profile_id, published_at desc nulls last);
create index profile_content_person_idx on profile_content (person_id, user_id)
  where person_id is not null;

create table profile_content_state (
  user_id text not null references app_users (id) on delete cascade,
  substack_profile_id text not null,
  person_id text,
  -- checked = last attempt (success or not); fetched = last success.
  notes_checked_at timestamptz,
  notes_fetched_at timestamptz,
  notes_error text,
  publication_url text,
  posts_checked_at timestamptz,
  posts_fetched_at timestamptz,
  posts_error text,
  feed_etag text,
  feed_last_modified text,
  updated_at timestamptz not null default now(),
  primary key (user_id, substack_profile_id),
  foreign key (person_id, user_id) references people (id, user_id)
    on delete set null (person_id)
);

alter table profile_content enable row level security;
alter table profile_content force row level security;
create policy profile_content_tenant on profile_content
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());
alter table profile_content_state enable row level security;
alter table profile_content_state force row level security;
create policy profile_content_state_tenant on profile_content_state
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());
