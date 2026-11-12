-- Watched Profiles stored each item's whole upstream object (~2.5 kB per Note,
-- ~30 kB per post) although only its ID and engagement counters are ever
-- needed beside the title/body/url columns. New rows keep just those; this
-- rewrites the rows stored so far. The table forces row security even for its
-- owner, so it is lifted for the rewrite and restored before commit.
alter table profile_content no force row level security;

update profile_content
set raw = jsonb_strip_nulls(jsonb_build_object(
  'context', raw->'context',
  'rss', raw->'rss',
  'comment', case when raw ? 'comment' then jsonb_build_object(
    'id', raw#>'{comment,id}', 'user_id', raw#>'{comment,user_id}',
    'reaction_count', raw#>'{comment,reaction_count}', 'restacks', raw#>'{comment,restacks}',
    'children_count', raw#>'{comment,children_count}', 'ancestor_path', raw#>'{comment,ancestor_path}') end,
  'post', case when raw ? 'post' then jsonb_build_object(
    'id', raw#>'{post,id}', 'publication_id', raw#>'{post,publication_id}',
    'audience', raw#>'{post,audience}', 'type', raw#>'{post,type}', 'wordcount', raw#>'{post,wordcount}',
    'reaction_count', raw#>'{post,reaction_count}', 'comment_count', raw#>'{post,comment_count}') end
));

alter table profile_content force row level security;
