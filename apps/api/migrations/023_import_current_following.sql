-- Run the updated following sweep once for active connections so profiles
-- missing from the CRM are imported without waiting for the next activity sync.
insert into jobs (type, payload, status, run_at)
select 'sync:following',
       jsonb_build_object('userId', connection.user_id, 'connectionId', connection.id, 'manual', false),
       'pending',
       now() + interval '1 minute'
from substack_connections connection
where connection.status = 'active'
  and not exists (
    select 1 from jobs existing
    where existing.type = 'sync:following'
      and existing.status in ('pending', 'running')
      and existing.payload->>'connectionId' = connection.id
  );
