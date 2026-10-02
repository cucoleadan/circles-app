-- Tags for organizing Notes on the /notes page. They are a separate catalog
-- from contact tags so Note topics never mix with contact labels. Tags are
-- Circles-only: Substack never sees them.
create table note_tags (
  id text primary key,
  user_id text not null references app_users (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  color text not null default '#f15a3a',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, normalized_name)
);

alter table scheduled_notes
  add constraint scheduled_notes_id_user_key unique (id, user_id);

-- Edges carry user_id so composite FKs make cross-tenant tagging impossible.
create table scheduled_note_tags (
  note_id text not null,
  tag_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id),
  foreign key (note_id, user_id) references scheduled_notes (id, user_id) on delete cascade,
  foreign key (tag_id, user_id) references note_tags (id, user_id) on delete cascade
);

create index scheduled_note_tags_tag_idx on scheduled_note_tags (tag_id, user_id);

alter table note_tags enable row level security;
create policy note_tags_tenant on note_tags
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());

alter table scheduled_note_tags enable row level security;
create policy scheduled_note_tags_tenant on scheduled_note_tags
  using (user_id = app_tenant_id()) with check (user_id = app_tenant_id());
