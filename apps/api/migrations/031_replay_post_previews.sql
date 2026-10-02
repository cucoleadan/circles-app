-- Outbound Likes/restacks of posts now keep the post's cover image and
-- publication (interactions.metadata targetImage/targetPublication) so the
-- timeline can show a Substack-style preview card. Replay the retained
-- profile-feed evidence to fill them for past actions without new Substack
-- reads. Replays are idempotent and metadata is merged, never cleared.
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
