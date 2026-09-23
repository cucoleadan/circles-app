-- Give active connections one paced pass over contacts with a stable profile
-- ID but no handle. Unresolvable private profiles remain handle-less.
insert into jobs (type, payload, status, run_at)
select 'enrich:missing-handles',
       jsonb_build_object('userId', connection.user_id, 'connectionId', connection.id),
       'pending',
       now() + interval '5 minutes'
from substack_connections connection
where connection.status = 'active'
  and exists (
    select 1 from people person
    where person.user_id = connection.user_id
      and person.archived_at is null
      and person.normalized_handle is null
      and person.substack_profile_id is not null
  )
  and not exists (
    select 1 from jobs existing
    where existing.type = 'enrich:missing-handles'
      and existing.status in ('pending', 'running')
      and existing.payload->>'connectionId' = connection.id
  );
