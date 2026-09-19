-- Migration 014: Comprehensive backfill of avatar_url from profile_snapshots and interactions metadata

-- 1. Reset avatar_url on any contact record that mistakenly got their tenant owner's avatar.
--    This dynamically finds all outbound interaction author photos (authored by the account owner)
--    and clears the avatar on any contact for that tenant whose avatar matches the owner's photo.
with owner_photos as (
  select distinct user_id, metadata->>'authorPhotoUrl' as owner_avatar
  from interactions
  where direction = 'outbound'
    and metadata->>'authorPhotoUrl' is not null
)
update people p
set avatar_url = null,
    updated_at = now()
from owner_photos op
join substack_connections sc on sc.user_id = op.user_id and sc.status = 'active'
where p.user_id = op.user_id
  and p.avatar_url = op.owner_avatar
  and (p.substack_profile_id is distinct from sc.profile_id and (p.handle is null or lower(p.handle) is distinct from lower(sc.profile_handle)));

-- 2. Backfill from profile_snapshots (where D1 imported payload has profile.photoUrl)
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

-- 3. Backfill from interactions metadata:
--    - For inbound interactions, the contact is the actor (actor.photo_url / actorAvatarUrl)
--    - For outbound interactions, the contact is the target (targetAuthor.photo_url)
--    - Exclude owner's photos and authorPhotoUrl (which belongs to the note/reply author)
with owner_photos as (
  select distinct user_id, metadata->>'authorPhotoUrl' as owner_avatar
  from interactions
  where direction = 'outbound'
    and metadata->>'authorPhotoUrl' is not null
)
update people p
set avatar_url = i.avatar_url,
    updated_at = now()
from (
  select i.person_id,
         max(coalesce(
           case 
             when i.direction = 'inbound' then coalesce(
               i.metadata->'actor'->>'photo_url',
               i.metadata->'actor'->>'avatarUrl',
               i.metadata->>'actorAvatarUrl'
             )
             when i.direction = 'outbound' then coalesce(
               i.metadata->'targetAuthor'->>'photo_url',
               i.metadata->'targetAuthor'->>'avatarUrl'
             )
           end
         )) as avatar_url
  from interactions i
  left join owner_photos op
    on op.user_id = i.user_id
   and op.owner_avatar = coalesce(
         case 
           when i.direction = 'inbound' then coalesce(
             i.metadata->'actor'->>'photo_url',
             i.metadata->'actor'->>'avatarUrl',
             i.metadata->>'actorAvatarUrl'
           )
           when i.direction = 'outbound' then coalesce(
             i.metadata->'targetAuthor'->>'photo_url',
             i.metadata->'targetAuthor'->>'avatarUrl'
           )
         end
       )
  where i.person_id is not null
    and op.owner_avatar is null
    and coalesce(
      case 
        when i.direction = 'inbound' then coalesce(
          i.metadata->'actor'->>'photo_url',
          i.metadata->'actor'->>'avatarUrl',
          i.metadata->>'actorAvatarUrl'
        )
        when i.direction = 'outbound' then coalesce(
          i.metadata->'targetAuthor'->>'photo_url',
          i.metadata->'targetAuthor'->>'avatarUrl'
        )
      end
    ) is not null
  group by i.person_id
) i
where i.person_id = p.id
  and (p.avatar_url is null or p.avatar_url = '');
