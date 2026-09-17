import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Rss, UsersRound } from "lucide-react";
import { Link, useFetcher, useRevalidator, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  CommunityContentNote,
  CommunityContentPost,
  CommunityContentProfile,
  CommunityContentSnapshot,
  CommunityActionResult,
  CommunityEngagement,
  CommunityList,
  CommunityPerson,
} from "./types";
import { NoteCard, PostCard, formatEngagementAction, formatEngagementSignal } from "./note-card";
import { relativeTime } from "./utils";
import { CreateNoteDialog } from "../scheduled-notes/note-dialogs";
import type { TaxonomyOption } from "../scheduled-notes/types";

type FeedItem =
  | {
      key: string;
      kind: "note";
      timestamp: string | null;
      person: CommunityPerson;
      profile: CommunityContentProfile;
      note: CommunityContentNote;
      engagementBadge?: string;
      engagedBack?: boolean;
    }
  | {
      key: string;
      kind: "post";
      timestamp: string | null;
      person: CommunityPerson;
      profile: CommunityContentProfile;
      post: CommunityContentPost;
      engagementBadge?: string;
      engagedBack?: boolean;
    };

type FeedFilter = "all" | "notes" | "posts";
type FeedMode = "latest" | "needs-engagement" | "engaged";

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

function timestampValue(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function PersonalFeed({
  people,
  lists,
  snapshots,
  engagements = [],
  tags = [],
  noteTypes = [],
}: {
  people: CommunityPerson[];
  lists: CommunityList[];
  snapshots: CommunityContentSnapshot[];
  engagements?: CommunityEngagement[];
  tags?: TaxonomyOption[];
  noteTypes?: TaxonomyOption[];
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const [scheduleRestack, setScheduleRestack] = useState<{
    post: CommunityContentPost;
    authorName?: string | null;
  } | null>(null);
  const requestedFilter = searchParams.get("content");
  const filter: FeedFilter =
    requestedFilter === "notes" || requestedFilter === "posts"
      ? requestedFilter
      : "all";
  const requestedListId = searchParams.get("list");
  const listId = lists.some((list) => list.id === requestedListId)
    ? requestedListId
    : null;
  const requestedMode = searchParams.get("mode");
  const mode: FeedMode =
    requestedMode === "needs-engagement"
      ? "needs-engagement"
      : requestedMode === "engaged"
        ? "engaged"
        : "latest";

  const refreshFetcher = useFetcher<CommunityActionResult>();
  const handledRefreshResult = useRef<CommunityActionResult | undefined>(
    refreshFetcher.data,
  );
  const submittedManualSyncId = useRef<string | null>(null);
  const [manualSync, setManualSync] = useState<{
    personIds: string[];
    index: number;
    failures: number;
  } | null>(null);

  const engagementByTargetId = useMemo(() => {
    const map = new Map<string, CommunityEngagement>();
    for (const eng of engagements) {
      if (!map.has(eng.targetId)) {
        map.set(eng.targetId, eng);
      }
    }
    return map;
  }, [engagements]);

  const items = useMemo(() => {
    const personById = new Map(people.map((person) => [person.id, person]));
    const nextItems: FeedItem[] = [];

    for (const snapshot of snapshots) {
      const person = personById.get(snapshot.personId);
      if (!person || !snapshot.content) continue;

      for (const note of snapshot.content.notes) {
        const eng = engagementByTargetId.get(note.id);
        const hasReplyAfterEng = Boolean(
          eng &&
          note.replyCount &&
          note.replyCount > 0 &&
          (eng.actionType === "comment" || eng.actionType === "reply"),
        );

        nextItems.push({
          key: `note:${snapshot.personId}:${note.id}`,
          kind: "note",
          timestamp: note.createdAt,
          person,
          profile: snapshot.content.profile,
          note,
          engagementBadge: eng ? formatEngagementAction(eng) : undefined,
          engagedBack: hasReplyAfterEng,
        });
      }

      for (const post of snapshot.content.posts) {
        const eng = engagementByTargetId.get(post.id);
        nextItems.push({
          key: `post:${snapshot.personId}:${post.id}`,
          kind: "post",
          timestamp: post.publishedAt,
          person,
          profile: snapshot.content.profile,
          post,
          engagementBadge: eng ? formatEngagementAction(eng) : undefined,
        });
      }
    }

    return nextItems.sort((left, right) => {
      if (mode === "engaged") {
        const leftEng = engagementByTargetId.get(left.kind === "note" ? left.note.id : left.post.id);
        const rightEng = engagementByTargetId.get(right.kind === "note" ? right.note.id : right.post.id);
        const engDiff = timestampValue(rightEng?.createdAt) - timestampValue(leftEng?.createdAt);
        if (engDiff) return engDiff;

        const personEngDiff =
          timestampValue(right.person.lastEngagedAt) -
          timestampValue(left.person.lastEngagedAt);
        if (personEngDiff) return personEngDiff;
      }

      const difference = timestampValue(right.timestamp) - timestampValue(left.timestamp);
      return difference || left.key.localeCompare(right.key);
    });
  }, [engagementByTargetId, mode, people, snapshots]);

  const visibleItems = items.filter((item) => {
    const matchesContent =
      filter === "all" ||
      (filter === "notes" ? item.kind === "note" : item.kind === "post");
    const matchesList =
      !listId || item.person.lists.some((list) => list.id === listId);

    let matchesMode = true;
    if (mode === "needs-engagement") {
      const lastEng = item.person.lastEngagedAt;
      matchesMode =
        !lastEng || Date.now() - Date.parse(lastEng) > FIVE_DAYS_MS;
    } else if (mode === "engaged") {
      matchesMode =
        Boolean(item.engagementBadge) || item.person.lastEngagedAt !== null;
    }

    return matchesContent && matchesList && matchesMode;
  });

  const readyProfiles = snapshots.filter((snapshot) => snapshot.content !== null).length;
  const snapshotsByPerson = new Map(
    snapshots.map((snapshot) => [snapshot.personId, snapshot]),
  );
  const waitingProfiles = people.filter((person) => {
    const snapshot = snapshotsByPerson.get(person.id);
    return !snapshot || snapshot.status === "pending";
  }).length;
  const staleProfiles = snapshots.filter((snapshot) => snapshot.status === "stale").length;
  const failedProfiles = snapshots.filter((snapshot) => snapshot.status === "error").length;

  const refreshTargets = useMemo(() => {
    const targetPeople = listId
      ? people.filter((p) => p.lists.some((l) => l.id === listId))
      : people;
    return targetPeople.map((p) => p.id);
  }, [listId, people]);

  const activeManualSyncId = manualSync?.personIds[manualSync.index] ?? null;
  const isManuallySyncing = activeManualSyncId !== null;

  function setFeedParam(name: "content" | "list" | "mode", value: string) {
    const next = new URLSearchParams(searchParams);
    const defaultValue = name === "content" ? "all" : name === "mode" ? "latest" : "";
    if (!value || value === defaultValue) next.delete(name);
    else next.set(name, value);
    setSearchParams(next, { preventScrollReset: true });
  }

  useEffect(() => {
    if (
      !activeManualSyncId ||
      refreshFetcher.state !== "idle" ||
      submittedManualSyncId.current === activeManualSyncId
    ) {
      return;
    }

    const timeout = window.setTimeout(
      () => {
        handledRefreshResult.current = refreshFetcher.data;
        submittedManualSyncId.current = activeManualSyncId;
        void refreshFetcher.submit(
          {
            intent: "refreshContent",
            personId: activeManualSyncId,
          },
          {
            method: "post",
            action: "/app/community",
          },
        );
      },
      manualSync?.index === 0 ? 0 : 500,
    );

    return () => window.clearTimeout(timeout);
  }, [
    activeManualSyncId,
    manualSync?.index,
    refreshFetcher.data,
    refreshFetcher.state,
    refreshFetcher.submit,
  ]);

  useEffect(() => {
    if (
      !activeManualSyncId ||
      refreshFetcher.state !== "idle" ||
      !refreshFetcher.data ||
      refreshFetcher.data === handledRefreshResult.current
    ) {
      return;
    }

    handledRefreshResult.current = refreshFetcher.data;
    const failed =
      !refreshFetcher.data.ok ||
      refreshFetcher.data.intent !== "refreshContent" ||
      refreshFetcher.data.personId !== activeManualSyncId;

    setManualSync((current) => {
      if (
        !current ||
        current.personIds[current.index] !== activeManualSyncId
      ) {
        return current;
      }
      return {
        ...current,
        index: current.index + 1,
        failures: current.failures + Number(failed),
      };
    });
  }, [activeManualSyncId, refreshFetcher.data, refreshFetcher.state]);

  useEffect(() => {
    if (manualSync && manualSync.index >= manualSync.personIds.length && manualSync.personIds.length > 0) {
      revalidator.revalidate();
    }
  }, [manualSync, revalidator]);

  function startManualSync() {
    if (refreshTargets.length === 0 || isManuallySyncing) return;
    submittedManualSyncId.current = null;
    setManualSync({
      personIds: refreshTargets,
      index: 0,
      failures: 0,
    });
  }

  return (
    <main className="px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight">
              Feed
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Latest public notes and posts from your lists.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isManuallySyncing || people.length === 0}
              onClick={startManualSync}
              className="gap-1.5 text-xs"
            >
              <RefreshCw
                className={cn("size-3.5", isManuallySyncing && "animate-spin")}
              />
              {isManuallySyncing
                ? `Refreshing ${manualSync!.index + 1}/${manualSync!.personIds.length}…`
                : "Refresh now"}
            </Button>
            <p className="text-xs text-muted-foreground tabular-nums">
              {people.length} {people.length === 1 ? "profile" : "profiles"} ·{" "}
              {items.length} updates
            </p>
          </div>
        </header>

        {people.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-12 text-center">
            <UsersRound className="mx-auto size-5 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">
              Your feed is ready for people
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Add profiles to your lists and their latest public notes and posts
              will appear here.
            </p>
            <Button asChild size="sm" className="mt-4">
              <Link to="/app/community">Open Lists & Members</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="inline-flex rounded-lg border border-border bg-muted p-0.5"
                  role="group"
                  aria-label="Filter feed by content type"
                >
                  {(["all", "notes", "posts"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={filter === option}
                      onClick={() => setFeedParam("content", option)}
                      className={cn(
                        "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                        filter === option
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <select
                  value={listId ?? ""}
                  onChange={(event) => setFeedParam("list", event.currentTarget.value)}
                  aria-label="Filter feed by list"
                  className="h-8 rounded-lg border border-input bg-background px-2.5 text-xs font-medium shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">All lists</option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>{list.name}</option>
                  ))}
                </select>
                <div
                  className="inline-flex rounded-lg border border-border bg-muted p-0.5"
                  role="group"
                  aria-label="Order feed"
                >
                  {[
                    { key: "latest", label: "Latest" },
                    { key: "needs-engagement", label: "Needs engagement" },
                    { key: "engaged", label: "Recently engaged" },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={mode === option.key}
                      onClick={() => setFeedParam("mode", option.key)}
                      className={cn(
                        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                        mode === option.key
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {readyProfiles} of {people.length} profiles synced · auto-refreshes hourly
                </span>
              </div>
            </div>

            {manualSync && manualSync.index >= manualSync.personIds.length && (
              <p
                className={cn(
                  "mt-3 text-xs",
                  manualSync.failures > 0
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
                aria-live="polite"
              >
                {manualSync.failures > 0
                  ? `Refresh finished, but ${manualSync.failures} ${manualSync.failures === 1 ? "profile" : "profiles"} could not be synced.`
                  : "Feed refreshed with latest content."}
              </p>
            )}

            {(waitingProfiles > 0 || staleProfiles > 0 || failedProfiles > 0) && (
              <div className="mt-3 rounded-lg border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
                {waitingProfiles > 0 &&
                  `${waitingProfiles} ${waitingProfiles === 1 ? "profile is" : "profiles are"} waiting for a first background sync. `}
                {staleProfiles > 0 &&
                  `${staleProfiles} ${staleProfiles === 1 ? "profile is" : "profiles are"} showing the last successful snapshot. `}
                {failedProfiles > 0 &&
                  `${failedProfiles} ${failedProfiles === 1 ? "profile has" : "profiles have"} no stored data yet.`}
              </div>
            )}

            <section className="mt-4 space-y-3">
              {visibleItems.map((item) =>
                item.kind === "note" ? (
                  <NoteCard
                    key={item.key}
                    note={item.note}
                    person={item.person}
                    profile={item.profile}
                    engagementBadge={item.engagementBadge}
                    engagedBack={item.engagedBack}
                  />
                ) : (
                  <PostCard
                    key={item.key}
                    post={item.post}
                    person={item.person}
                    profile={item.profile}
                    engagementBadge={item.engagementBadge}
                    engagedBack={item.engagedBack}
                    onRestack={(post) =>
                      setScheduleRestack({
                        post,
                        authorName: item.profile.name || item.person.name,
                      })
                    }
                  />
                ),
              )}
              {visibleItems.length === 0 && (
                <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
                  <Rss className="mx-auto size-5 text-muted-foreground" />
                  <h2 className="mt-3 text-sm font-semibold">
                    No matching updates
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {mode === "needs-engagement"
                      ? "Great job! You've engaged with all your listed contacts within the last 5 days."
                      : mode === "engaged"
                        ? "Engage with a member's Note (like, comment, restack) to see your recent interaction history here."
                        : listId
                          ? "This list has no public content matching the selected filters."
                          : readyProfiles === 0
                        ? "Background synchronization has not stored any profile content yet."
                        : "Substack did not return public content for this view."}
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        {scheduleRestack && (
          <CreateNoteDialog
            date={new Date()}
            state="ready"
            tags={tags}
            noteTypes={noteTypes}
            initialArticleUrl={scheduleRestack.post.url ?? undefined}
            restackInfo={{
              authorName: scheduleRestack.authorName,
              postTitle: scheduleRestack.post.title,
            }}
            action="/app/scheduled-notes"
            onClose={() => setScheduleRestack(null)}
          />
        )}
      </div>
    </main>
  );
}
