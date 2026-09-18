-- User customizable settings stored as JSONB on app_users
alter table app_users
  add column if not exists settings jsonb not null default '{}'::jsonb;
