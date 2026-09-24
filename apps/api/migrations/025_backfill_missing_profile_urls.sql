-- Older imported contacts can have a handle without a profile URL. Build the
-- public profile link from the stored normalized handle; this does not fetch
-- Substack data or infer/merge identities.
update people
set profile_url = 'https://substack.com/@' || normalized_handle,
    updated_at = now()
where (profile_url is null or btrim(profile_url) = '')
  and handle is not null
  and normalized_handle ~ '^[a-z0-9._-]+$';
