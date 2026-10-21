-- Since 2026-10-13 Substack answers its follower list
-- (/api/v1/user/{id}/subscriber-lists?lists=followers) with a Cloudflare
-- challenge for every non-browser client, so the follower sweep is retired.
-- Follow notifications from the activity sync still set people.is_follower.
-- Stop queued sweeps and close import streams still waiting on one; rows that
-- already exist stay as history.
update jobs
set status = 'dead',
    last_error = 'Follower sweep retired; followers now come from follow notifications',
    updated_at = now()
where type = 'sync:followers' and status = 'pending';

update import_run_streams
set status = 'unavailable', completeness = 'unavailable', finish_reason = 'upstream_retired',
    error = 'Substack no longer serves the follower list to Circles; followers come from notifications',
    updated_at = now()
where stream = 'followers' and status in ('running', 'paused');

update import_runs r
set status = case when exists (
      select 1 from import_run_streams s where s.import_run_id = r.id and s.status = 'failed'
    ) then 'failed' else 'complete' end,
    finish_reason = 'all_streams_finished'
where r.status = 'running'
  and exists (select 1 from import_run_streams s where s.import_run_id = r.id and s.stream = 'followers')
  and not exists (
    select 1 from import_run_streams s
    where s.import_run_id = r.id and s.status not in ('complete', 'unavailable', 'failed')
  );
