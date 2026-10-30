-- The extension now reads Substack with the user's own browser session: the
-- notifications feed about every 10 minutes and the subscriber and following
-- lists about once a day. The worker stays the fallback, so it needs to know
-- when a browser read last finished for a connection: it skips its own
-- notifications poll while a browser poll is under 15 minutes old, and its
-- audience sweeps while a browser sweep is under 48 hours old.
-- browser_subscriber_run tracks the subscriber sweep in progress
-- ({runStartedAt, nextOffset}) so pages are accepted only in order, and a
-- sweep that skipped a page can never mark people as unsubscribed.
alter table substack_connections
  add column browser_activity_at timestamptz,
  add column browser_subscribers_at timestamptz,
  add column browser_following_at timestamptz,
  add column browser_subscriber_run jsonb;
