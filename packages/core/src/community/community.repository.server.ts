import {
  COMMUNITY_COLORS,
  COMMUNITY_STATUSES,
  type CommunityColor,
  type CommunityData,
  type CommunityEngagement,
  type CommunityInteraction,
  type CommunityLabel,
  type CommunityPerson,
  type CommunityPersonHandleEntry,
  type CommunityStatus,
  type DriftStatus,
  type PinnedCommunityView,
} from "./types";
import { recalculateCommunityRelationship } from "./relationship-ingestion.server";

type PersonRow = {
  id: string;
  name: string;
  handle: string;
  profile_url: string;
  publication_url: string | null;
  relationship_status: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  last_engaged_at: string | null;
  first_interacted_at?: string | null;
  interaction_count?: number | null;
  conversation_count?: number | null;
  drift_status?: string | null;
  ai_summary?: string | null;
  ai_suggested_action?: string | null;
  ai_topics_json?: string | null;
  ai_summarized_at?: string | null;
};

type TagRow = {
  id: string;
  name: string;
  color: string;
};

type ListRow = {
  id: string;
  name: string;
  description: string | null;
};

type PersonTagRow = TagRow & { person_id: string };
type PersonListRow = { person_id: string; id: string; name: string };
type PinRow = { id: string; tag_id: string | null; list_id: string | null };

export type CommunityPersonSource = {
  id: string;
  handle: string;
  publicationUrl: string | null;
};

export type CommunityPersonIdentifiers = {
  name: string | null;
  handle: string | null;
  publicationUrl: string | null;
};

function isCommunityColor(value: string): value is CommunityColor {
  return (COMMUNITY_COLORS as readonly string[]).includes(value);
}

function isCommunityStatus(value: string): value is CommunityStatus {
  return (COMMUNITY_STATUSES as readonly string[]).includes(value);
}

function labelFromRow(row: TagRow): CommunityLabel {
  return {
    id: row.id,
    name: row.name,
    color: isCommunityColor(row.color) ? row.color : "slate",
  };
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function colorForName(value: string): CommunityColor {
  const index = [...normalizeName(value)].reduce(
    (total, character) => total + character.codePointAt(0)!,
    0,
  );
  return COMMUNITY_COLORS[index % COMMUNITY_COLORS.length];
}

async function resolveCommunityTag(db: D1Database, userId: string, providedName: string) {
  const name = providedName.trim().replace(/\s+/g, " ");
  const normalizedName = normalizeName(name);
  const now = new Date().toISOString();

  await db
    .prepare(
      "INSERT INTO community_tags (id, user_id, name, normalized_name, color, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, normalized_name) DO UPDATE SET " +
        "name = excluded.name, updated_at = excluded.updated_at",
    )
    .bind(crypto.randomUUID(), userId, name, normalizedName, colorForName(name), now, now)
    .run();

  const tag = await db
    .prepare("SELECT id, name, color FROM community_tags WHERE user_id = ? AND normalized_name = ? LIMIT 1")
    .bind(userId, normalizedName)
    .first<TagRow>();
  if (!tag) throw new Error("The community tag could not be saved.");
  return labelFromRow(tag);
}

async function resolveCommunityTags(db: D1Database, userId: string, names: string[]) {
  const tags: CommunityLabel[] = [];
  for (const name of names) tags.push(await resolveCommunityTag(db, userId, name));
  return tags;
}

function personRelationshipStatements({
  db,
  userId,
  personId,
  tags,
  listIds,
  now,
}: {
  db: D1Database;
  userId: string;
  personId: string;
  tags: CommunityLabel[];
  listIds: string[];
  now: string;
}) {
  return [
    ...tags.map((tag) =>
      db
        .prepare("INSERT INTO community_person_tags (person_id, tag_id, created_at) VALUES (?, ?, ?)")
        .bind(personId, tag.id, now),
    ),
    ...listIds.map((listId) =>
      db
        .prepare(
          "INSERT INTO community_list_members (list_id, person_id, created_at) " +
            "SELECT id, ?, ? FROM community_lists WHERE id = ? AND user_id = ?",
        )
        .bind(personId, now, listId, userId),
    ),
  ];
}

export async function getCommunityData(db: D1Database, userId: string): Promise<CommunityData> {
  const [peopleResult, tagsResult, listsResult, personTagsResult, personListsResult, pinsResult, engagementsResult] =
    await Promise.all([
      db
        .prepare(
          "SELECT id, name, handle, profile_url, publication_url, relationship_status, notes, " +
            "created_at, updated_at, last_engaged_at, first_interacted_at, interaction_count, " +
            "conversation_count, drift_status, ai_summary, ai_suggested_action, ai_topics_json, ai_summarized_at " +
            "FROM community_people WHERE user_id = ? ORDER BY name COLLATE NOCASE",
        )
        .bind(userId)
        .all<PersonRow>(),
      db
        .prepare("SELECT id, name, color FROM community_tags WHERE user_id = ? ORDER BY name COLLATE NOCASE")
        .bind(userId)
        .all<TagRow>(),
      db
        .prepare("SELECT id, name, description FROM community_lists WHERE user_id = ? ORDER BY name COLLATE NOCASE")
        .bind(userId)
        .all<ListRow>(),
      db
        .prepare(
          "SELECT cpt.person_id, ct.id, ct.name, ct.color FROM community_person_tags cpt " +
            "JOIN community_tags ct ON ct.id = cpt.tag_id " +
            "JOIN community_people cp ON cp.id = cpt.person_id " +
            "WHERE cp.user_id = ? ORDER BY ct.name COLLATE NOCASE",
        )
        .bind(userId)
        .all<PersonTagRow>(),
      db
        .prepare(
          "SELECT clm.person_id, cl.id, cl.name FROM community_list_members clm " +
            "JOIN community_lists cl ON cl.id = clm.list_id " +
            "JOIN community_people cp ON cp.id = clm.person_id " +
            "WHERE cp.user_id = ? ORDER BY cl.name COLLATE NOCASE",
        )
        .bind(userId)
        .all<PersonListRow>(),
      db
        .prepare("SELECT id, tag_id, list_id FROM community_dashboard_views WHERE user_id = ?")
        .bind(userId)
        .all<PinRow>(),
      listCommunityEngagements(db, userId, 100).catch(() => [] as CommunityEngagement[]),
    ]);

  const tagsByPerson = new Map<string, CommunityLabel[]>();
  for (const row of personTagsResult.results) {
    tagsByPerson.set(row.person_id, [...(tagsByPerson.get(row.person_id) ?? []), labelFromRow(row)]);
  }

  const listsByPerson = new Map<string, Array<{ id: string; name: string }>>();
  const memberCountByList = new Map<string, number>();
  for (const row of personListsResult.results) {
    listsByPerson.set(row.person_id, [
      ...(listsByPerson.get(row.person_id) ?? []),
      { id: row.id, name: row.name },
    ]);
    memberCountByList.set(row.id, (memberCountByList.get(row.id) ?? 0) + 1);
  }

  const pinnedTags = new Set(pinsResult.results.flatMap((row) => (row.tag_id ? [row.tag_id] : [])));
  const pinnedLists = new Set(pinsResult.results.flatMap((row) => (row.list_id ? [row.list_id] : [])));

  const people = peopleResult.results.map(
    (row): CommunityPerson => ({
      id: row.id,
      name: row.name,
      handle: row.handle,
      profileUrl: row.profile_url,
      publicationUrl: row.publication_url,
      status:
        row.relationship_status && isCommunityStatus(row.relationship_status)
          ? row.relationship_status
          : null,
      notes: row.notes,
      tags: tagsByPerson.get(row.id) ?? [],
      lists: listsByPerson.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastEngagedAt: row.last_engaged_at,
      firstInteractedAt: row.first_interacted_at ?? null,
      interactionCount: row.interaction_count ?? 0,
      conversationCount: row.conversation_count ?? 0,
      driftStatus: (row.drift_status as DriftStatus) ?? "new",
      aiSummary: row.ai_summary ?? null,
      aiSuggestedAction: row.ai_suggested_action ?? null,
      aiTopics: row.ai_topics_json ? JSON.parse(row.ai_topics_json) : [],
      aiSummarizedAt: row.ai_summarized_at ?? null,
    }),
  );

  return {
    people,
    tags: tagsResult.results.map((row) => ({ ...labelFromRow(row), pinned: pinnedTags.has(row.id) })),
    lists: listsResult.results.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      memberCount: memberCountByList.get(row.id) ?? 0,
      pinned: pinnedLists.has(row.id),
    })),
    engagements: engagementsResult,
  };
}

export async function getCommunityPersonSource(
  db: D1Database,
  userId: string,
  personId: string,
): Promise<CommunityPersonSource | null> {
  const person = await db
    .prepare(
      "SELECT id, handle, publication_url FROM community_people WHERE id = ? AND user_id = ? LIMIT 1",
    )
    .bind(personId, userId)
    .first<{ id: string; handle: string; publication_url: string | null }>();

  return person
    ? { id: person.id, handle: person.handle, publicationUrl: person.publication_url }
    : null;
}

export async function listCommunityPersonHandles(
  db: D1Database,
  userId: string,
): Promise<string[]> {
  const result = await db
    .prepare("SELECT normalized_handle FROM community_people WHERE user_id = ?")
    .bind(userId)
    .all<{ normalized_handle: string }>();
  return result.results.map((row) => row.normalized_handle);
}

export async function listCommunityLists(
  db: D1Database,
  userId: string,
): Promise<Array<{ id: string; name: string; description: string | null }>> {
  const result = await db
    .prepare("SELECT id, name, description FROM community_lists WHERE user_id = ? ORDER BY name COLLATE NOCASE")
    .bind(userId)
    .all<ListRow>();
  return result.results;
}

export async function listCommunityPersonIdentifiers(
  db: D1Database,
  userId: string,
): Promise<CommunityPersonIdentifiers[]> {
  const result = await db
    .prepare("SELECT name, handle, publication_url FROM community_people WHERE user_id = ?")
    .bind(userId)
    .all<{ name: string; handle: string; publication_url: string | null }>();

  return result.results.map((row) => ({
    name: row.name,
    handle: row.handle,
    publicationUrl: row.publication_url,
  }));
}

export async function getPinnedCommunityViews(
  db: D1Database,
  userId: string,
): Promise<PinnedCommunityView[]> {
  const data = await getCommunityData(db, userId);
  return [
    ...data.tags
      .filter((tag) => tag.pinned)
      .map(
        (tag): PinnedCommunityView => ({
          id: `tag:${tag.id}`,
          kind: "tag",
          sourceId: tag.id,
          name: tag.name,
          color: tag.color,
          people: data.people.filter((person) => person.tags.some((item) => item.id === tag.id)),
        }),
      ),
    ...data.lists
      .filter((list) => list.pinned)
      .map(
        (list): PinnedCommunityView => ({
          id: `list:${list.id}`,
          kind: "list",
          sourceId: list.id,
          name: list.name,
          color: null,
          people: data.people.filter((person) => person.lists.some((item) => item.id === list.id)),
        }),
      ),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listCommunityPersonHandlesWithLists(
  db: D1Database,
  userId: string,
): Promise<CommunityPersonHandleEntry[]> {
  const [peopleResult, personListsResult] = await Promise.all([
    db
      .prepare("SELECT id, name, normalized_handle FROM community_people WHERE user_id = ? ORDER BY name COLLATE NOCASE")
      .bind(userId)
      .all<{ id: string; name: string; normalized_handle: string }>(),
    db
      .prepare(
        "SELECT clm.person_id, cl.id, cl.name FROM community_list_members clm " +
          "JOIN community_lists cl ON cl.id = clm.list_id " +
          "JOIN community_people cp ON cp.id = clm.person_id " +
          "WHERE cp.user_id = ? ORDER BY cl.name COLLATE NOCASE",
      )
      .bind(userId)
      .all<PersonListRow>(),
  ]);

  const listsByPerson = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of personListsResult.results) {
    listsByPerson.set(row.person_id, [
      ...(listsByPerson.get(row.person_id) ?? []),
      { id: row.id, name: row.name },
    ]);
  }

  return peopleResult.results.map((person) => ({
    handle: person.normalized_handle,
    name: person.name,
    lists: listsByPerson.get(person.id) ?? [],
  }));
}

export async function createCommunityPerson({
  db,
  userId,
  name,
  handle,
  profileUrl,
  publicationUrl,
  status,
  notes,
  tagNames,
  listIds,
}: {
  db: D1Database;
  userId: string;
  name: string;
  handle: string;
  profileUrl: string;
  publicationUrl: string | null;
  status: CommunityStatus | null;
  notes: string | null;
  tagNames: string[];
  listIds: string[];
}) {
  const normalizedHandle = handle.toLocaleLowerCase("en");
  const existing = await db
    .prepare(
      "SELECT id, handle, publication_url FROM community_people WHERE user_id = ? AND normalized_handle = ? LIMIT 1",
    )
    .bind(userId, normalizedHandle)
    .first<{ id: string; handle: string; publication_url: string | null }>();

  if (existing) {
    const tags = await resolveCommunityTags(db, userId, tagNames);
    const now = new Date().toISOString();
    const statements = [];
    if (publicationUrl && !existing.publication_url) {
      statements.push(
        db
          .prepare(
            "UPDATE community_people SET publication_url = ?, updated_at = ? WHERE id = ? AND user_id = ?",
          )
          .bind(publicationUrl, now, existing.id, userId),
      );
    }
    statements.push(
      ...tags.map((tag) =>
        db
          .prepare(
            "INSERT OR IGNORE INTO community_person_tags (person_id, tag_id, created_at) VALUES (?, ?, ?)",
          )
          .bind(existing.id, tag.id, now),
      ),
      ...listIds.map((listId) =>
        db
          .prepare(
            "INSERT OR IGNORE INTO community_list_members (list_id, person_id, created_at) " +
              "SELECT id, ?, ? FROM community_lists WHERE id = ? AND user_id = ?",
          )
          .bind(existing.id, now, listId, userId),
      ),
    );
    if (statements.length > 0) {
      await db.batch(statements);
    }
    return {
      id: existing.id,
      handle: existing.handle,
      publicationUrl: publicationUrl ?? existing.publication_url,
    } satisfies CommunityPersonSource;
  }

  const tags = await resolveCommunityTags(db, userId, tagNames);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO community_people (id, user_id, name, handle, normalized_handle, profile_url, " +
          "publication_url, status, relationship_status, notes, created_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        userId,
        name,
        handle,
        normalizedHandle,
        profileUrl,
        publicationUrl,
        status ?? "new",
        status,
        notes,
        now,
        now,
      ),
    ...personRelationshipStatements({ db, userId, personId: id, tags, listIds, now }),
  ]);

  return { id, handle, publicationUrl } satisfies CommunityPersonSource;
}

export async function updateCommunityPerson({
  db,
  userId,
  personId,
  name,
  handle,
  profileUrl,
  publicationUrl,
  status,
  notes,
  tagNames,
  listIds,
}: {
  db: D1Database;
  userId: string;
  personId: string;
  name: string;
  handle: string;
  profileUrl: string;
  publicationUrl: string | null;
  status: CommunityStatus | null;
  notes: string | null;
  tagNames: string[];
  listIds: string[];
}) {
  const existing = await db
    .prepare("SELECT id FROM community_people WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(personId, userId)
    .first<{ id: string }>();
  if (!existing) throw new Error("This community member could not be found.");

  const tags = await resolveCommunityTags(db, userId, tagNames);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE community_people SET name = ?, handle = ?, normalized_handle = ?, profile_url = ?, " +
          "publication_url = ?, status = ?, relationship_status = ?, notes = ?, updated_at = ? " +
            "WHERE id = ? AND user_id = ?",
      )
      .bind(
        name,
        handle,
        handle.toLocaleLowerCase("en"),
        profileUrl,
        publicationUrl,
        status ?? "new",
        status,
        notes,
        now,
        personId,
        userId,
      ),
    db
      .prepare("DELETE FROM community_content_snapshots WHERE person_id = ?")
      .bind(personId),
    db.prepare("DELETE FROM community_person_tags WHERE person_id = ?").bind(personId),
    db.prepare("DELETE FROM community_list_members WHERE person_id = ?").bind(personId),
    ...personRelationshipStatements({ db, userId, personId, tags, listIds, now }),
  ]);
}

export async function deleteCommunityPerson(db: D1Database, userId: string, personId: string) {
  await db
    .prepare("DELETE FROM community_people WHERE id = ? AND user_id = ?")
    .bind(personId, userId)
    .run();
}

export async function markCommunityPersonEngaged(
  db: D1Database,
  userId: string,
  personId: string,
) {
  await db
    .prepare(
      "UPDATE community_people SET last_engaged_at = ? WHERE id = ? AND user_id = ?",
    )
    .bind(new Date().toISOString(), personId, userId)
    .run();
}

export async function createCommunityList(
  db: D1Database,
  userId: string,
  name: string,
  description: string | null,
): Promise<{ id: string; name: string; description: string | null }> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO community_lists (id, user_id, name, normalized_name, description, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, userId, name, normalizeName(name), description, now, now)
    .run();
  return { id, name, description };
}

export async function deleteCommunityList(db: D1Database, userId: string, listId: string) {
  await db
    .prepare("DELETE FROM community_lists WHERE id = ? AND user_id = ?")
    .bind(listId, userId)
    .run();
}

export async function setCommunityDashboardPin({
  db,
  userId,
  kind,
  sourceId,
  pinned,
}: {
  db: D1Database;
  userId: string;
  kind: "tag" | "list";
  sourceId: string;
  pinned: boolean;
}) {
  const column = kind === "tag" ? "tag_id" : "list_id";
  if (!pinned) {
    await db
      .prepare(`DELETE FROM community_dashboard_views WHERE user_id = ? AND ${column} = ?`)
      .bind(userId, sourceId)
      .run();
    return;
  }

  const table = kind === "tag" ? "community_tags" : "community_lists";
  const source = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ? AND user_id = ? LIMIT 1`)
    .bind(sourceId, userId)
    .first<{ id: string }>();
  if (!source) throw new Error("That Community view could not be found.");

  const tagId = kind === "tag" ? sourceId : null;
  const listId = kind === "list" ? sourceId : null;
  await db
    .prepare(
      "INSERT OR IGNORE INTO community_dashboard_views (id, user_id, tag_id, list_id, created_at) " +
        "VALUES (?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), userId, tagId, listId, new Date().toISOString())
    .run();
}

export async function logCommunityEngagement({
  db,
  userId,
  personId,
  targetId,
  targetType,
  actionType,
  metadata,
  externalId,
  threadRootId,
}: {
  db: D1Database;
  userId: string;
  personId?: string | null;
  targetId: string;
  targetType: "note" | "post" | "comment";
  actionType: "like" | "comment" | "reply" | "restack";
  externalId?: string | null;
  threadRootId?: string | null;
  metadata?: {
    title?: string;
    body?: string;
    url?: string;
    authorName?: string;
    authorHandle?: string;
  } | null;
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  const interactionExternalId = externalId ?? `outbound:${id}`;
  await db.batch([
    db
      .prepare(
        "INSERT INTO community_engagements (id, user_id, person_id, target_id, target_type, action_type, metadata_json, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        userId,
        personId ?? null,
        targetId,
        targetType,
        actionType,
        metadataJson,
        now,
      ),
    db
      .prepare(
        "INSERT INTO community_interactions (" +
          "id, user_id, person_id, external_id, direction, action_type, target_type, " +
          "target_id, target_title, target_url, thread_root_id, body, occurred_at, metadata_json, created_at" +
        ") VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(user_id, external_id) DO NOTHING",
      )
      .bind(
        crypto.randomUUID(),
        userId,
        personId ?? null,
        interactionExternalId,
        actionType,
        targetType,
        targetId,
        metadata?.title ?? null,
        metadata?.url ?? null,
        threadRootId ?? null,
        metadata?.body ?? null,
        now,
        metadataJson,
        now,
      ),
    ...(personId
      ? [
          db
            .prepare(
              "UPDATE community_people SET last_engaged_at = ? WHERE id = ? AND user_id = ?",
            )
            .bind(now, personId, userId),
        ]
      : []),
  ]);

  if (personId) {
    await recalculateCommunityRelationship(db, userId, personId, now);
  }
}

export async function listCommunityEngagements(
  db: D1Database,
  userId: string,
  limit = 50,
): Promise<CommunityEngagement[]> {
  const rows = await db
    .prepare(
      "SELECT id, person_id, target_id, target_type, action_type, metadata_json, created_at " +
        "FROM community_engagements WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .bind(userId, limit)
    .all<{
      id: string;
      person_id: string | null;
      target_id: string;
      target_type: "note" | "post" | "comment";
      action_type: "like" | "comment" | "reply" | "restack";
      metadata_json: string | null;
      created_at: string;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    personId: row.person_id,
    targetId: row.target_id,
    targetType: row.target_type,
    actionType: row.action_type,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    createdAt: row.created_at,
  }));
}

export async function togglePersonListMembership({
  db,
  userId,
  personId,
  listId,
  included,
}: {
  db: D1Database;
  userId: string;
  personId: string;
  listId: string;
  included: boolean;
}) {
  if (included) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO community_list_members (list_id, person_id, created_at) " +
          "SELECT id, ?, ? FROM community_lists WHERE id = ? AND user_id = ?",
      )
      .bind(personId, new Date().toISOString(), listId, userId)
      .run();
  } else {
    await db
      .prepare(
        "DELETE FROM community_list_members WHERE person_id = ? AND list_id = (" +
          "SELECT id FROM community_lists WHERE id = ? AND user_id = ?" +
        ")",
      )
      .bind(personId, listId, userId)
      .run();
  }
}

export async function listCommunityInteractions(
  db: D1Database,
  userId: string,
  personId?: string | null,
  limit = 100,
): Promise<CommunityInteraction[]> {
  const query = personId
    ? "SELECT id, user_id, person_id, external_id, direction, action_type, target_type, target_id, target_title, target_url, thread_root_id, body, occurred_at, metadata_json, created_at FROM community_interactions WHERE user_id = ? AND person_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?"
    : "SELECT id, user_id, person_id, external_id, direction, action_type, target_type, target_id, target_title, target_url, thread_root_id, body, occurred_at, metadata_json, created_at FROM community_interactions WHERE user_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?";

  const bindings = personId ? [userId, personId, limit] : [userId, limit];
  const rows = await db
    .prepare(query)
    .bind(...bindings)
    .all<{
      id: string;
      user_id: string;
      person_id: string | null;
      external_id: string;
      direction: "inbound" | "outbound";
      action_type: "comment" | "reply" | "like" | "restack" | "subscribe" | "mention" | "other";
      target_type: "post" | "note" | "comment" | "profile" | null;
      target_id: string | null;
      target_title: string | null;
      target_url: string | null;
      thread_root_id: string | null;
      body: string | null;
      occurred_at: string;
      metadata_json: string | null;
      created_at: string;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    userId: row.user_id,
    personId: row.person_id,
    externalId: row.external_id,
    direction: row.direction,
    actionType: row.action_type,
    targetType: row.target_type,
    targetId: row.target_id,
    targetTitle: row.target_title,
    targetUrl: row.target_url,
    threadRootId: row.thread_root_id,
    body: row.body,
    occurredAt: row.occurred_at,
    metadata: parseInteractionMetadata(row.metadata_json),
    createdAt: row.created_at,
  }));
}

function parseInteractionMetadata(value: string | null): Record<string, unknown> | null {
  try {
    const parsed: unknown = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
