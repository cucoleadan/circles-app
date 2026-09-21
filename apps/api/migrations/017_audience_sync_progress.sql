-- Track follower status checks separately from the boolean result. Existing
-- false values predate reliable follower checks and therefore remain unchecked.
alter table people
  add column if not exists follower_checked_at timestamptz;

create index if not exists people_follower_check_idx
  on people (user_id, follower_checked_at, id)
  where archived_at is null
    and (handle is not null or substack_profile_id is not null);
