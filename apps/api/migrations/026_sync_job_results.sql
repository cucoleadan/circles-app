-- Keep only structured, non-sensitive counters for the recent sync panel.
alter table jobs add column result jsonb;

create index jobs_sync_activity_connection_idx
  on jobs ((payload->>'connectionId'), id desc)
  where type = 'sync:activity';

create index jobs_sync_parent_idx
  on jobs ((payload->>'parentJobId'), id)
  where payload ? 'parentJobId';
