-- Migration 013: Add avatar_url to people table and backfill from retained profile snapshots
alter table people
  add column if not exists avatar_url text;

-- Backfill from profile_snapshots if available
update people p
set avatar_url = ps.payload->>'photo_url',
    updated_at = now()
from profile_snapshots ps
where ps.person_id = p.id
  and ps.payload->>'photo_url' is not null
  and (p.avatar_url is null or p.avatar_url = '');
