-- D1 import preparation: app users arrive before their Better Auth
-- counterpart exists; auth_user_id is linked during the Phase 6 cutover.
alter table app_users alter column auth_user_id drop not null;
