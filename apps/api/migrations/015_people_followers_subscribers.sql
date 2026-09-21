-- Migration 015: Add is_follower, is_subscriber, subscribed_at, subscription_tier to people table

alter table people
  add column if not exists is_follower boolean not null default false,
  add column if not exists is_subscriber boolean not null default false,
  add column if not exists subscribed_at timestamptz,
  add column if not exists subscription_tier text;

-- Partial index for audience filtering
create index if not exists people_follower_subscriber_idx
  on people (user_id, is_follower, is_subscriber)
  where archived_at is null;

-- Backfill existing is_subscriber = true for people who have proven subscribe interactions
update people p
set is_subscriber = true,
    updated_at = now()
where exists (
  select 1 from interactions i
  where i.person_id = p.id
    and i.action_type = 'subscribe'
    and i.removed_at is null
)
and not p.is_subscriber;
