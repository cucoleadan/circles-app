#!/usr/bin/env bash
# Exports every D1 source table to JSON for the PostgreSQL converter.
# Run from the stackedhq-app checkout with wrangler authenticated:
#   DATABASE=stackedhq-app-db OUT=../circles-app/scripts/migration/exports ./d1-export.sh
set -euo pipefail

DB="${DATABASE:-stackedhq-app-db}"
OUT="${OUT:-exports}"
mkdir -p "$OUT"

TABLES=(
  users
  substack_connections
  community_people
  community_tags
  community_person_tags
  community_lists
  community_list_members
  community_dashboard_views
  community_interactions
  community_engagements
  community_content_snapshots
  activity_snapshots
  note_replies_snapshots
  community_activity_backfills
)

for table in "${TABLES[@]}"; do
  echo "exporting $table"
  npx wrangler d1 execute "$DB" --remote --json \
    --command "select * from $table" > "$OUT/$table.json"
done

echo "done: $OUT"
