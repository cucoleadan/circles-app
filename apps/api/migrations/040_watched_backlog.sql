-- Watched Profiles backlog: when a contact is added, the worker walks their
-- profile feed back in batches of 7 days until it holds the last 30 days, and
-- never further. backfill_cursor is the feed position to continue from,
-- backfill_until the oldest Note date reached so far.
alter table profile_content_state
  add column backfill_cursor text,
  add column backfill_until timestamptz,
  add column backfill_checked_at timestamptz,
  add column backfill_done boolean not null default false;

-- Both tables force row security even for their owner, so lift it for the two
-- repairs below; it is restored before this migration's transaction commits.
alter table profile_content_state no force row level security;
alter table profile_content no force row level security;

-- Profiles read before this migration start their backlog on the next run.
update profile_content_state set notes_checked_at = null;

-- The first reads stored RSS posts with no age limit; keep only the 30 days.
delete from profile_content
where source in ('watched', 'rss') and published_at < now() - interval '30 days';

alter table profile_content_state force row level security;
alter table profile_content force row level security;
