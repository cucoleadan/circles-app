-- SDK 0.3.15 exposes authenticated, cursor-paginated profile Likes,
-- restacks, and authored replies. Reactivate the previously unavailable
-- outbound stream on the most recent successful/running import so deployment
-- automatically repairs existing accounts without requiring another full run.
create temporary table outbound_history_runs on commit drop as
select distinct on (r.connection_id)
       r.id as import_run_id, r.user_id, r.connection_id
from import_runs r
join substack_connections c
  on c.id = r.connection_id and c.user_id = r.user_id
join import_run_streams s
  on s.import_run_id = r.id and s.stream = 'outbound_actions'
where c.status = 'active'
  and r.status in ('running', 'complete')
  and s.status = 'unavailable'
order by r.connection_id, r.started_at desc;

update import_run_streams s
set status = 'running', completeness = 'partial', finish_reason = null,
    error = null, cursor = null, pages = 0, items = 0,
    new_interactions = 0, new_people = 0, updated_at = now()
from outbound_history_runs selected
where s.import_run_id = selected.import_run_id
  and s.stream = 'outbound_actions';

update import_runs r
set status = 'running', finish_reason = null, error = null
from outbound_history_runs selected
where r.id = selected.import_run_id;

insert into jobs (type, payload, status, run_at)
select 'import:history',
       json_build_object(
         'userId', selected.user_id,
         'connectionId', selected.connection_id,
         'importRunId', selected.import_run_id,
         'stream', 'outbound_actions'
       ),
       'pending', now()
from outbound_history_runs selected;

update sync_stream_state state
set status = 'idle', completeness = 'partial', finish_reason = 'sdk_profile_feed',
    error = null, cursor = null, updated_at = now()
from substack_connections connection
where state.connection_id = connection.id
  and state.stream = 'outbound_actions'
  and connection.status = 'active';
