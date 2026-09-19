-- Migration 014: Comprehensive backfill of avatar_url from profile_snapshots and interactions metadata

-- 1. Backfill from profile_snapshots (where D1 imported payload has profile.photoUrl)
update people p
set avatar_url = coalesce(
      ps.payload->'profile'->>'photoUrl',
      ps.payload->'profile'->>'photo_url',
      ps.payload->>'photoUrl',
      ps.payload->>'photo_url',
      ps.payload->>'avatar_url'
    ),
    updated_at = now()
from profile_snapshots ps
where ps.person_id = p.id
  and coalesce(
      ps.payload->'profile'->>'photoUrl',
      ps.payload->'profile'->>'photo_url',
      ps.payload->>'photoUrl',
      ps.payload->>'photo_url',
      ps.payload->>'avatar_url'
    ) is not null
  and (p.avatar_url is null or p.avatar_url = '');

-- 2. Backfill from interactions.metadata (where activity items saved actorAvatarUrl / authorPhotoUrl)
update people p
set avatar_url = i.avatar_url,
    updated_at = now()
from (
  select person_id,
         max(coalesce(metadata->>'actorAvatarUrl', metadata->>'authorPhotoUrl', metadata->>'photoUrl', metadata->>'photo_url')) as avatar_url
  from interactions
  where person_id is not null
    and coalesce(metadata->>'actorAvatarUrl', metadata->>'authorPhotoUrl', metadata->>'photoUrl', metadata->>'photo_url') is not null
  group by person_id
) i
where i.person_id = p.id
  and (p.avatar_url is null or p.avatar_url = '');
