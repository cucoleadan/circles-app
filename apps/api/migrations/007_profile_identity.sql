-- Substack reply payloads reliably include user_id even when no public handle is
-- present. Keep one active CRM person per upstream identity.
create unique index if not exists people_user_substack_profile_idx
  on people (user_id, substack_profile_id)
  where substack_profile_id is not null and archived_at is null;

-- Reprocess already-retained raw Note replies after the identity parser update.
-- This repairs existing backfills locally without requesting the same history
-- from Substack again.
insert into jobs (type, payload, status, run_at)
select 'reprocess:note-snapshots',
       json_build_object('userId', c.user_id, 'connectionId', c.id),
       'pending', now()
from substack_connections c
where c.status = 'active'
  and exists (
    select 1 from note_replies_snapshots n where n.connection_id = c.id
  );
