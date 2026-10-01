-- Self-healing recurring sync.
--
-- The 3-hour activity sync is a job chain: each run schedules the next. The
-- chain used to end when a connection was replaced or a run dead-lettered, and
-- migrations 021 and 024 had to restart it by hand. The worker now calls this
-- function every few minutes so any active connection without a queued or
-- running activity job gets one. It runs as the migration owner so the
-- restricted runtime role can see every active connection without tenant
-- context, but it only inserts jobs and never returns tenant data.
create or replace function seed_missing_activity_syncs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  seeded integer;
begin
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
  get diagnostics seeded = row_count;
  return seeded;
end;
$$;

revoke all on function seed_missing_activity_syncs() from public;
grant execute on function seed_missing_activity_syncs() to circles_app;

-- Restart any chain that is currently stranded.
select seed_missing_activity_syncs();

-- Scheduled activity sync used to discard items whose created_at was older
-- than three hours, which dropped new likers on grouped notifications and
-- anything past the first page. The raw pages were retained, so replay them
-- through the fixed ingestion path to recover those interactions.
insert into jobs (type, payload, status, run_at)
select 'reprocess:interaction-evidence',
       jsonb_build_object('userId', connection.user_id, 'connectionId', connection.id),
       'pending', now() + interval '2 minutes'
from substack_connections connection
where connection.status = 'active'
  and not exists (
    select 1
    from jobs existing
    where existing.type = 'reprocess:interaction-evidence'
      and existing.status in ('pending', 'running')
      and existing.payload->>'connectionId' = connection.id
  );
