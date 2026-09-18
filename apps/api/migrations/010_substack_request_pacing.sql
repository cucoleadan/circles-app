-- Backfills previously fanned out all streams at once. Space already-pending
-- authenticated work so a deployment does not immediately reproduce a burst.
with pending as (
  select job.id,
         row_number() over (
           partition by job.payload->>'connectionId'
           order by job.run_at, job.id
         ) as position
  from jobs job
  where job.status = 'pending'
    and job.type in ('sync:activity', 'sync:history', 'import:history')
)
update jobs job
set run_at = greatest(job.run_at, now() + pending.position * interval '10 seconds'),
    attempts = case when job.last_error like '%429%' then 0 else job.attempts end,
    updated_at = now()
from pending
where job.id = pending.id;

-- A 429 is a temporary upstream throttle, not a terminal import failure. A
-- historical post returning 404 is now skipped per item rather than failing
-- the whole stream. A failed parent run also used to strand sibling streams in
-- `running`, because their queued jobs would exit when they saw the parent.
-- Resume all of those cases from their saved checkpoints.
create temporary table stalled_import_streams on commit drop as
select stream.import_run_id, stream.user_id, stream.connection_id, stream.stream
from import_run_streams stream
join import_runs run on run.id = stream.import_run_id
join substack_connections connection on connection.id = stream.connection_id
where connection.status = 'active'
  and (
    (stream.status = 'failed' and (
      stream.error like '%429%'
      or (stream.stream = 'owned_posts' and stream.error like '%404%')
    ))
    or (run.status = 'failed' and stream.status = 'running')
  );

update import_run_streams stream
set status = 'running', completeness = 'partial', finish_reason = null,
    error = 'Queued to resume with request pacing', updated_at = now()
from stalled_import_streams retry
where stream.import_run_id = retry.import_run_id
  and stream.stream = retry.stream;

update import_runs run
set status = 'running', finish_reason = null, error = null
from stalled_import_streams retry
where run.id = retry.import_run_id;

insert into jobs (type, payload, status, run_at, max_attempts)
select 'import:history',
       json_build_object(
         'userId', retry.user_id,
         'connectionId', retry.connection_id,
         'importRunId', retry.import_run_id,
         'stream', retry.stream
       ),
       'pending',
       now() + row_number() over (
         partition by retry.connection_id order by retry.stream
       ) * interval '10 seconds',
       5
from stalled_import_streams retry
where not exists (
  select 1 from jobs existing
  where existing.type = 'import:history'
    and existing.status in ('pending', 'running')
    and existing.payload->>'importRunId' = retry.import_run_id
    and existing.payload->>'stream' = retry.stream
);
