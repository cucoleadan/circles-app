-- Restore the recurring activity job for active connections stranded by the
-- prior self-matching queue dedupe. The fixed worker schedules later runs.
insert into jobs (type, payload, status, run_at)
select 'sync:activity',
       jsonb_build_object('userId', connection.user_id, 'connectionId', connection.id),
       'pending',
       now()
from substack_connections connection
where connection.status = 'active'
  and not exists (
    select 1
    from jobs existing
    where existing.type = 'sync:activity'
      and existing.status in ('pending', 'running')
      and existing.payload->>'connectionId' = connection.id
  );
