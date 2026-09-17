-- Phase 3: Add engagement_score to relationship_stats
-- Scoring: like = 1, restack without note = 2, comment/reply = 3, restack with note = 3

alter table relationship_stats
  add column if not exists engagement_score integer not null default 0;

create index if not exists relationship_stats_user_engagement_idx
  on relationship_stats (user_id, engagement_score desc);
