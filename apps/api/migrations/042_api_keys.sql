-- API keys created in the dashboard for scripts that want plain HTTP instead of
-- MCP OAuth. Each key is a first-party "oauthClient" with an "oauthConsent"
-- holding its scopes, so MCP scope checks, the SDK-read worker, the /mcp agent
-- list and revocation (which deletes the consent) apply to keys unchanged.
-- Only the SHA-256 of the key is stored; like Better Auth's session and token
-- tables, it is looked up before a tenant is known, so it has no RLS.
create table api_keys (
  client_id text primary key references "oauthClient"("clientId") on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
