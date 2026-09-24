-- Activity ingestion records follows as interactions and updates follower state.
-- The original action-type constraint omitted 'follow', causing the entire
-- activity job to fail when a follow appeared in the newest feed page.
alter table interactions
  drop constraint interactions_action_type_check;

alter table interactions
  add constraint interactions_action_type_check check (action_type in
    ('comment', 'reply', 'like', 'restack', 'follow', 'subscribe', 'mention', 'other'));

-- Failed activity jobs do not schedule their successor, so restart any active
-- connection whose queue was stranded by this constraint failure.
insert into jobs (type, payload, status, run_at)
select 'sync:activity',
       jsonb_build_object('userId', connection.user_id, 'connectionId', connection.id),
       'pending',
       now()
from substack_connections connection
where connection.status = 'active'
  and not exists (
    select 1 from jobs existing
    where existing.type = 'sync:activity'
      and existing.status in ('pending', 'running')
      and existing.payload->>'connectionId' = connection.id
  );
