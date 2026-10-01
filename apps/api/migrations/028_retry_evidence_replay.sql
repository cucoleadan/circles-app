-- The evidence replay queued by migration 027 dead-lettered on
-- interactions_active_action_target_idx: re-ingesting a Like that migration 011
-- had soft-removed as a duplicate tried to restore it beside the surviving
-- active row. Ingestion now leaves such duplicates removed, so queue the replay
-- again. Replays are idempotent, so starting from the first batch is safe.
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
