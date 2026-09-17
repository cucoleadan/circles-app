import { env } from "cloudflare:workers";

import { requireAppUser } from "../auth/auth.server";
import { getGatewayConnection } from "../connections/connection.repository.server";
import { communityContentRead } from "../../services/gateway/cache/registry.server";
import { refreshGatewayReadWithResult } from "../../services/gateway/cache/refresh.server";
import { invalidateGatewayMutation } from "../../services/gateway/cache/invalidation.server";
import { createGatewayRequestPacer } from "../../services/gateway/request-pacer.server";
import {
  getCommunityContentSnapshot,
  storeCommunityContentSnapshot,
  syncCommunityContentSnapshot,
} from "./community-content-snapshot.repository.server";
import { getGatewayActivity } from "../../services/gateway/activity.server";
import { ingestActivityIntoRelationships } from "./relationship-ingestion.server";
import {
  createGatewayNoteComment,
  createGatewayNoteRestack,
  createGatewayNoteReply,
  getGatewayNoteReplies,
  setGatewayNoteReaction,
} from "../../services/gateway/note-engagement.server";
import {
  createCommunityList,
  createCommunityPerson,
  deleteCommunityList,
  deleteCommunityPerson,
  getCommunityPersonSource,
  logCommunityEngagement,
  markCommunityPersonEngaged,
  setCommunityDashboardPin,
  togglePersonListMembership,
  updateCommunityPerson,
} from "./community.repository.server";
import {
  COMMUNITY_STATUSES,
  type CommunityActionResult,
  type CommunityIntent,
  type CommunityStatus,
} from "./types";

const MAX_TAGS = 8;
const MAX_LISTS = 20;
const INTENTS: CommunityIntent[] = [
  "loadContent",
  "refreshContent",
  "loadNoteComments",
  "setNoteReaction",
  "commentOnNote",
  "restackNote",
  "replyToNoteComment",
  "createPerson",
  "updatePerson",
  "deletePerson",
  "createList",
  "deleteList",
  "togglePersonList",
  "pinView",
  "unpinView",
];

function isSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function formString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function cleanText(value: string | null, label: string, maxLength: number, required = true) {
  const clean = value?.trim().replace(/\s+/g, " ") ?? "";
  if ((required && !clean) || clean.length > maxLength) {
    throw new Error(
      required
        ? `${label} must be between 1 and ${maxLength} characters.`
        : `${label} must be ${maxLength} characters or fewer.`,
    );
  }
  return clean;
}

function cleanLongText(value: string | null, label: string, maxLength: number) {
  const clean = value?.trim() ?? "";
  if (clean.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return clean || null;
}

function parseHandle(value: string | null) {
  let handle = value?.trim() ?? "";
  if (/^https?:\/\//i.test(handle)) {
    try {
      const url = new URL(handle);
      const profileMatch = url.pathname.match(/^\/@([^/]+)/);
      handle = profileMatch?.[1] ?? "";
    } catch {
      throw new Error("Enter a valid Substack handle or profile URL.");
    }
  }
  handle = handle.replace(/^@/, "").toLocaleLowerCase("en");
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(handle)) {
    throw new Error("Use a valid Substack handle with letters, numbers, underscores, or hyphens.");
  }
  return { handle, profileUrl: `https://substack.com/@${handle}` };
}

function parseStatus(value: string | null): CommunityStatus | null {
  if (!value) return null;
  if ((COMMUNITY_STATUSES as readonly string[]).includes(value)) {
    return value as CommunityStatus;
  }
  throw new Error("Choose a valid relationship status or leave it blank.");
}

function parseOptionalPersonId(formData: FormData) {
  const value = formString(formData, "personId");
  return value ? cleanText(value, "Community person ID", 80) : null;
}

function parseOptionalPublicationUrl(value: string | null) {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  if (raw.length > 500) throw new Error("Publication URL must be 500 characters or fewer.");

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname) {
      throw new Error();
    }
    if (url.username || url.password) throw new Error();
    url.hash = "";
    return url.toString();
  } catch {
    throw new Error("Enter a valid publication URL, such as https://example.substack.com.");
  }
}

function uniqueValues(
  values: FormDataEntryValue[],
  label: string,
  maxItems: number,
  maxLength: number,
) {
  const unique = new Map<string, string>();
  for (const value of values) {
    if (typeof value !== "string") throw new Error(`${label} is invalid.`);
    const clean = cleanText(value, label, maxLength);
    unique.set(clean.toLocaleLowerCase("en"), clean);
  }
  if (unique.size > maxItems) throw new Error(`Choose up to ${maxItems} ${label.toLocaleLowerCase("en")}.`);
  return [...unique.values()];
}

function parsePerson(formData: FormData) {
  const name = cleanText(formString(formData, "name"), "Name", 80);
  const { handle, profileUrl } = parseHandle(formString(formData, "handle"));
  return {
    name,
    handle,
    profileUrl,
    publicationUrl: parseOptionalPublicationUrl(formString(formData, "publicationUrl")),
    status: parseStatus(formString(formData, "status")),
    notes: cleanLongText(formString(formData, "notes"), "Notes", 5_000),
    tagNames: uniqueValues(formData.getAll("tags"), "Tags", MAX_TAGS, 32),
    listIds: uniqueValues(formData.getAll("lists"), "Lists", MAX_LISTS, 80),
  };
}

function parseNoteId(formData: FormData) {
  return cleanText(formString(formData, "noteId"), "Note ID", 512);
}

function parseParentCommentId(formData: FormData) {
  return cleanText(
    formString(formData, "parentCommentId"),
    "Parent comment ID",
    512,
  );
}

function parseLiked(formData: FormData) {
  const value = formString(formData, "liked");
  if (value !== "true" && value !== "false") {
    throw new Error("The requested Note reaction is invalid.");
  }
  return value === "true";
}

function parseCommentBody(formData: FormData) {
  const body = formString(formData, "body")?.trim() ?? "";
  if (!body || body.length > 5_000) {
    throw new Error("Comment must be between 1 and 5,000 characters.");
  }
  return body;
}

function friendlyMessage(cause: unknown) {
  if (!(cause instanceof Error)) return "The Community change could not be saved.";
  if (cause.message.includes("UNIQUE constraint failed: community_people.user_id")) {
    return "That Substack handle is already in your Community.";
  }
  if (cause.message.includes("UNIQUE constraint failed: community_lists.user_id")) {
    return "A list with that name already exists.";
  }
  return cause.message;
}

export async function handleCommunityAction(
  args: Parameters<typeof requireAppUser>[0],
): Promise<CommunityActionResult> {
  const formData = await args.request.formData();
  const rawIntent = formString(formData, "intent");
  const intent = INTENTS.includes(rawIntent as CommunityIntent)
    ? (rawIntent as CommunityIntent)
    : "createPerson";

  if (!rawIntent || !INTENTS.includes(rawIntent as CommunityIntent)) {
    return { ok: false, intent, message: "Unsupported Community request." };
  }
  if (!isSameOrigin(args.request)) {
    return { ok: false, intent, message: "This request was rejected. Refresh and try again." };
  }

  const user = await requireAppUser(args, env.stackedhq_app_db);

  try {
    if (intent === "loadContent" || intent === "refreshContent") {
      const personId = formString(formData, "personId");
      if (!personId) throw new Error("This community member is missing an ID.");

      const [person, connection] = await Promise.all([
        getCommunityPersonSource(env.stackedhq_app_db, user.id, personId),
        getGatewayConnection(env.stackedhq_app_db, user.id),
      ]);
      if (!person) throw new Error("This community member could not be found.");
      if (!connection?.publicationUrl) {
        throw new Error("Connect your Substack account before loading Community content.");
      }

      if (intent === "loadContent") {
        const snapshot = await getCommunityContentSnapshot(
          env.stackedhq_app_db,
          user.id,
          person.id,
        );
        if (!snapshot?.content || !snapshot.syncedAt) {
          throw new Error(
            "This profile is waiting for its first background sync. Check again shortly.",
          );
        }
        return {
          ok: true,
          intent,
          personId: person.id,
          content: snapshot.content,
          cache: {
            status: "hit",
            cachedAt: snapshot.syncedAt,
            expiresAt: new Date(
              Date.parse(snapshot.syncedAt) + 3_600_000,
            ).toISOString(),
          },
        };
      }

      const synced = await syncCommunityContentSnapshot(
        env,
        {
          personId: person.id,
          userId: user.id,
          connectionId: connection.id,
          publicationUrl: connection.publicationUrl,
          handle: person.handle,
          targetPublicationUrl: person.publicationUrl,
          envelope: connection.envelope,
        },
        createGatewayRequestPacer({
          requestsPerSecond: 2,
        }),
      );
      if (!synced) {
        return { ok: false, intent, message: "Could not sync community profile with Substack." };
      }
      const snapshot = await getCommunityContentSnapshot(
        env.stackedhq_app_db,
        user.id,
        person.id,
      );
      if (!snapshot?.content || !snapshot.syncedAt) {
        throw new Error("Refreshed profile content is unavailable. Please retry.");
      }
      return {
        ok: true,
        intent,
        personId: person.id,
        content: snapshot.content,
        cache: { status: "refreshed", cachedAt: snapshot.syncedAt, expiresAt: new Date(Date.parse(snapshot.syncedAt) + 3_600_000).toISOString() },
      };
    }

    if (
      intent === "loadNoteComments" ||
      intent === "setNoteReaction" ||
      intent === "commentOnNote" ||
      intent === "restackNote" ||
      intent === "replyToNoteComment"
    ) {
      const noteId = parseNoteId(formData);
      const personId = parseOptionalPersonId(formData);
      const connection = await getGatewayConnection(env.stackedhq_app_db, user.id);
      if (!connection?.publicationUrl) {
        throw new Error("Connect your Substack account before loading or engaging with Notes.");
      }

      const gatewayInput = {
        envelope: connection.envelope,
        publicationUrl: connection.publicationUrl,
        noteId,
      };
      const scope = { userId: user.id, connectionId: connection.id };

      const noteUrl = formString(formData, "noteUrl");
      const noteBody = formString(formData, "noteBody");
      const authorName = formString(formData, "authorName");
      const authorHandle = formString(formData, "authorHandle");
      const baseMetadata = {
        url: noteUrl ?? undefined,
        body: noteBody ? noteBody.slice(0, 300) : undefined,
        authorName: authorName ?? undefined,
        authorHandle: authorHandle ?? undefined,
      };

      const refreshSnapshot = async () => {
        if (!personId || !connection.publicationUrl) return;
        try {
          const person = await getCommunityPersonSource(env.stackedhq_app_db, user.id, personId);
          if (person) {
            await syncCommunityContentSnapshot(
              env,
              {
                personId: person.id,
                userId: user.id,
                connectionId: connection.id,
                publicationUrl: connection.publicationUrl,
                handle: person.handle,
                targetPublicationUrl: person.publicationUrl,
                envelope: connection.envelope,
              },
              createGatewayRequestPacer({ requestsPerSecond: 2 }),
            );
          }
        } catch {
          // background sync will catch up
        }
      };

      if (intent === "loadNoteComments") {
        const replies = await getGatewayNoteReplies(gatewayInput);
        return { ok: true, intent, noteId, replies };
      }

      if (intent === "setNoteReaction") {
        const liked = parseLiked(formData);
        const result = await setGatewayNoteReaction({
          ...gatewayInput,
          liked,
        });
        if (liked) {
          await logCommunityEngagement({
            db: env.stackedhq_app_db,
            userId: user.id,
            personId: personId ?? undefined,
            targetId: noteId,
            targetType: "note",
            actionType: "like",
            metadata: baseMetadata,
          }).catch(() => undefined);
        }
        await invalidateGatewayMutation(scope, "setNoteReaction").catch(() => undefined);
        await refreshSnapshot();
        return { ok: true, intent, ...result };
      }

      if (intent === "replyToNoteComment") {
        const parentCommentId = parseParentCommentId(formData);
        const commentBody = parseCommentBody(formData);
        const result = await createGatewayNoteReply({
          ...gatewayInput,
          parentCommentId,
          body: commentBody,
        });
        await logCommunityEngagement({
          db: env.stackedhq_app_db,
          userId: user.id,
          personId: personId ?? undefined,
          targetId: parentCommentId,
          targetType: "comment",
          actionType: "reply",
          externalId: result.commentId ? `comment:${result.commentId}` : null,
          threadRootId: noteId,
          metadata: { ...baseMetadata, body: commentBody.slice(0, 300) },
        }).catch(() => undefined);
        await invalidateGatewayMutation(scope, "commentOnNote").catch(() => undefined);
        await refreshSnapshot();
        return { ok: true, intent, ...result };
      }

      if (intent === "restackNote") {
        const result = await createGatewayNoteRestack(gatewayInput);
        await logCommunityEngagement({
          db: env.stackedhq_app_db,
          userId: user.id,
          personId: personId ?? undefined,
          targetId: noteId,
          targetType: "note",
          actionType: "restack",
          metadata: baseMetadata,
        }).catch(() => undefined);
        await invalidateGatewayMutation(scope, "restackNote").catch(() => undefined);
        await refreshSnapshot();
        return { ok: true, intent, ...result };
      }

      const commentBody = parseCommentBody(formData);
      const result = await createGatewayNoteComment({
        ...gatewayInput,
        body: commentBody,
      });
      await logCommunityEngagement({
        db: env.stackedhq_app_db,
        userId: user.id,
        personId: personId ?? undefined,
        targetId: noteId,
        targetType: "note",
        actionType: "comment",
        externalId: result.commentId ? `comment:${result.commentId}` : null,
        threadRootId: noteId,
        metadata: { ...baseMetadata, body: commentBody.slice(0, 300) },
      }).catch(() => undefined);
      await invalidateGatewayMutation(scope, "commentOnNote").catch(() => undefined);
      await refreshSnapshot();
      return { ok: true, intent, ...result };
    }

    if (intent === "createPerson") {
      const person = await createCommunityPerson({
        db: env.stackedhq_app_db,
        userId: user.id,
        ...parsePerson(formData),
      });
      try {
        const connection = await getGatewayConnection(
          env.stackedhq_app_db,
          user.id,
        );
        if (connection?.publicationUrl) {
          await syncCommunityContentSnapshot(
            env,
            {
              personId: person.id,
              userId: user.id,
              connectionId: connection.id,
              publicationUrl: connection.publicationUrl,
              handle: person.handle,
              targetPublicationUrl: person.publicationUrl,
              envelope: connection.envelope,
            },
            createGatewayRequestPacer({ requestsPerSecond: 2 }),
          );
        }
      } catch {
        // The profile is already saved. The frequent background pass will retry it.
      }
    } else if (intent === "updatePerson") {
      const personId = formString(formData, "personId");
      if (!personId) throw new Error("This community member is missing an ID.");
      await updateCommunityPerson({
        db: env.stackedhq_app_db,
        userId: user.id,
        personId,
        ...parsePerson(formData),
      });
    } else if (intent === "deletePerson") {
      const personId = formString(formData, "personId");
      if (!personId) throw new Error("This community member is missing an ID.");
      await deleteCommunityPerson(env.stackedhq_app_db, user.id, personId);
    } else if (intent === "createList") {
      await createCommunityList(
        env.stackedhq_app_db,
        user.id,
        cleanText(formString(formData, "name"), "List name", 50),
        cleanLongText(formString(formData, "description"), "Description", 200),
      );
    } else if (intent === "deleteList") {
      const listId = formString(formData, "listId");
      if (!listId) throw new Error("This list is missing an ID.");
      await deleteCommunityList(env.stackedhq_app_db, user.id, listId);
    } else if (intent === "togglePersonList") {
      const personId = formString(formData, "personId");
      const listId = formString(formData, "listId");
      const included = formString(formData, "included") === "true";
      if (!personId || !listId) throw new Error("Missing person or list ID.");
      await togglePersonListMembership({
        db: env.stackedhq_app_db,
        userId: user.id,
        personId,
        listId,
        included,
      });
    } else if (intent === "pinView" || intent === "unpinView") {
      const kind = formString(formData, "kind");
      const sourceId = formString(formData, "sourceId");
      if ((kind !== "tag" && kind !== "list") || !sourceId) {
        throw new Error("That dashboard view could not be found.");
      }
      await setCommunityDashboardPin({
        db: env.stackedhq_app_db,
        userId: user.id,
        kind,
        sourceId,
        pinned: intent === "pinView",
      });
    } else if (intent === "syncRelationships") {
      const connection = await getGatewayConnection(
        env.stackedhq_app_db,
        user.id,
      );
      if (!connection?.publicationUrl) {
        throw new Error("No connected Substack publication found to sync from.");
      }

      console.log(`[StackedHQ CRM] Manual relationship sync requested by user ${user.id}`);
      const rawActivity = await getGatewayActivity({
        envelope: connection.envelope,
        publicationUrl: connection.publicationUrl,
        allSenders: true,
      });

      const stats = await ingestActivityIntoRelationships({
        db: env.stackedhq_app_db,
        userId: user.id,
        items: rawActivity,
        ownerHandle: connection.profile.handle,
      });

      return { ok: true, intent, stats };
    }
    return { ok: true, intent };
  } catch (cause) {
    return {
      ok: false,
      intent,
      message: friendlyMessage(cause),
      ...((intent === "loadNoteComments" ||
        intent === "setNoteReaction" ||
        intent === "commentOnNote" ||
        intent === "replyToNoteComment") && {
        noteId: formString(formData, "noteId") ?? undefined,
      }),
    };
  }
}
