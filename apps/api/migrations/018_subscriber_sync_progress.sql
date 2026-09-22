-- Make full subscriber imports authoritative in both directions. Rows observed
-- during a run receive its progress marker; only a successfully completed run
-- may clear stale current-membership flags.
alter table people
  add column if not exists subscriber_checked_at timestamptz;

create index if not exists people_subscriber_check_idx
  on people (user_id, subscriber_checked_at, id)
  where archived_at is null and is_subscriber = true;
