-- Keep inbound and outbound audience relationships independent and expose the
-- two new current-state repair streams in unified imports.
alter table people
  add column if not exists is_following boolean not null default false,
  add column if not exists is_subscribed_to boolean not null default false,
  add column if not exists following_checked_at timestamptz;

alter table import_run_streams
  drop constraint if exists import_run_streams_stream_check;

alter table import_run_streams
  add constraint import_run_streams_stream_check check (stream in
    ('activity', 'owned_notes', 'owned_posts', 'outbound_actions',
     'subscribers', 'followers', 'following', 'missing_handles'));
