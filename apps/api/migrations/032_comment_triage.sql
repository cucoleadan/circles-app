-- A CRM choice, kept outside metadata so evidence replays cannot overwrite it.
alter table interactions add column not_interested boolean not null default false;

create index interactions_outbound_comment_target_idx
  on interactions (user_id, connection_id, target_id)
  where direction = 'outbound' and removed_at is null
    and action_type in ('like', 'comment', 'reply');
