import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  MessageSquareText,
  RefreshCw,
  Rss,
} from "lucide-react";
import { Link, useFetcher, useRevalidator, useSearchParams, useNavigation } from "react-router";
import { ConversationTimeline } from "./person-timeline";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  CommunityActionResult,
  CommunityContentNoteImage,
  CommunityContentPost,
  CommunityContentSnapshot,
  CommunityEngagement,
  CommunityPerson,
  CommunityInteraction,
} from "./types";
import { NoteCard, PostCard, ProfileAvatar, formatEngagementAction, formatEngagementSignal } from "./note-card";
import { readableDate } from "./utils";
import { CreateNoteDialog } from "../scheduled-notes/note-dialogs";
import type { TaxonomyOption } from "../scheduled-notes/types";

function ContentEmpty({ kind }: { kind: "posts" | "notes" }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      {kind === "posts" ? (
        <BookOpenText className="mx-auto size-5 text-muted-foreground" />
      ) : (
        <MessageSquareText className="mx-auto size-5 text-muted-foreground" />
      )}
      <p className="mt-3 text-sm font-semibold">No recent {kind}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Substack did not return any public {kind} for this profile.
      </p>
    </div>
  );
}

export function CommunityContentPage({
  person,
  initialSnapshot,
  engagements = [],
  interactions = [],
  hasMoreHistory = false,
  historyLimit = 100,
  historyCapped = false,
  tags = [],
  noteTypes = [],
}: {
  person: CommunityPerson;
  initialSnapshot: CommunityContentSnapshot | null;
  engagements?: CommunityEngagement[];
  interactions?: CommunityInteraction[];
  hasMoreHistory?: boolean;
  historyLimit?: number;
  historyCapped?: boolean;
  tags?: TaxonomyOption[];
  noteTypes?: TaxonomyOption[];
}) {
  const fetcher = useFetcher<CommunityActionResult>();
  const revalidator = useRevalidator();
  const [view, setView] = useState<"timeline" | "notes" | "posts">("timeline");
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const [snapshot, setSnapshot] = useState<CommunityContentSnapshot | null>(
    initialSnapshot,
  );
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<CommunityContentNoteImage | null>(null);
  const [scheduleRestack, setScheduleRestack] = useState<{
    post: CommunityContentPost;
    authorName?: string | null;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const engagementByTargetId = useMemo(() => {
    const map = new Map<string, CommunityEngagement>();
    for (const eng of engagements) {
      map.set(eng.targetId, eng);
    }
    return map;
  }, [engagements]);

  useEffect(() => {
    const result = fetcher.data;
    if (
      result?.ok &&
      result.intent === "refreshContent" &&
      result.personId === person.id
    ) {
      setSnapshot({
        personId: person.id,
        content: result.content,
        syncedAt: result.cache.cachedAt,
        lastAttemptedAt: result.cache.cachedAt,
        status: "ready",
      });
      setRetryAt(result.retryAt ?? null);
      revalidator.revalidate();
    } else if (
      result &&
      !result.ok &&
      result.intent === "refreshContent" &&
      result.retryAt
    ) {
      setRetryAt(result.retryAt);
    }
  }, [fetcher.data, person.id, revalidator]);

  const pending = fetcher.state !== "idle";
  const refreshError =
    !pending && fetcher.data && !fetcher.data.ok ? fetcher.data.message : null;
  const snapshotError =
    snapshot?.status === "error"
      ? "The first background sync was unsuccessful. It will retry automatically."
      : snapshot?.status === "stale"
        ? "The latest refresh failed, so this page is showing the last successful snapshot."
        : null;
  const error = refreshError ?? snapshotError;
  const content = snapshot?.content;
  const cachedAt = snapshot?.syncedAt ? Date.parse(snapshot.syncedAt) : Number.NaN;
  const retryTimestamp = retryAt ? Date.parse(retryAt) : Number.NaN;
  const refreshAvailableAt = Math.max(
    Number.isFinite(cachedAt) ? cachedAt + 60_000 : 0,
    Number.isFinite(retryTimestamp) ? retryTimestamp : 0,
  );
  const refreshWaitSeconds = Math.max(
    0,
    Math.ceil((refreshAvailableAt - now) / 1_000),
  );

  useEffect(() => {
    if (refreshWaitSeconds === 0) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), 1_000);
    return () => window.clearTimeout(timeout);
  }, [refreshWaitSeconds]);

  function refresh() {
    if (refreshWaitSeconds > 0) return;
    setNow(Date.now());
    fetcher.submit(
      { intent: "refreshContent", personId: person.id },
      { method: "post", action: "/app/community" },
    );
  }

  const profile = content?.profile ?? {
    id: person.id,
    name: person.name,
    handle: person.handle,
    photoUrl: null,
    bio: null,
    publication: null,
    followerCount: null,
    followingCount: null,
  };

  return (
    <main className="px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground hover:text-foreground"
        >
          <Link to="/app/community">
            <ArrowLeft /> Community
          </Link>
        </Button>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <ProfileAvatar
              name={profile.name ?? person.name}
              photoUrl={profile.photoUrl ?? null}
              className="size-12 text-base"
            />
            <div className="min-w-0">
              <h1 className="font-heading text-lg font-semibold tracking-tight">
                {profile.name ?? person.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                @{profile.handle ?? person.handle}
              </p>
              {profile.bio && (
                <p className="mt-1.5 max-w-lg text-sm leading-6 text-muted-foreground">
                  {profile.bio}
                </p>
              )}
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={person.profileUrl} target="_blank" rel="noreferrer">
              Profile <ArrowUpRight />
            </a>
          </Button>
        </header>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex rounded-lg border border-border bg-muted p-0.5"
            role="group"
            aria-label="Person view"
          >
            {(["timeline", "notes", "posts"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setView(option)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                  view === option
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option}{" "}
                {option === "timeline" ? `(${interactions.length})` : content
                  ? `(${option === "notes" ? content.notes.length : content.posts.length})`
                  : ""}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {view === "timeline" ? <Button type="button" variant="outline" size="sm" onClick={() => revalidator.revalidate()} disabled={revalidator.state !== "idle"}><RefreshCw className={cn(revalidator.state !== "idle" && "animate-spin")} /> Reload history</Button> : <>
            {snapshot?.syncedAt && (
              <span className="text-xs text-muted-foreground">
                Synced {readableDate(snapshot.syncedAt)}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={pending || refreshWaitSeconds > 0}
              title={
                refreshWaitSeconds > 0
                  ? `Refresh is available in ${refreshWaitSeconds} seconds`
                  : undefined
              }
            >
              <RefreshCw className={cn(pending && "animate-spin")} /> Refresh
              {refreshWaitSeconds > 0 && ` in ${refreshWaitSeconds}s`}
            </Button>
            </>}
          </div>
        </div>

        {error && view !== "timeline" && (
          <div className="mt-3 rounded-lg border border-rose-200/70 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-100">
            {error}
          </div>
        )}

        <div className="mt-4">
          {view === "timeline" ? <>
            <ConversationTimeline person={person} interactions={interactions} hasMore={hasMoreHistory} loading={navigation.state !== "idle"} onLoadMore={() => {
              const next = new URLSearchParams(searchParams);
              next.set("history", String(Math.min(historyLimit + 100, 1000)));
              setSearchParams(next, { preventScrollReset: true });
            }} />
            {historyCapped && <p className="mt-4 text-xs text-muted-foreground">Showing the latest 1,000 interactions. Older history remains stored.</p>}
          </> : !content ? (
            <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-border">
              <div className="text-center text-sm text-muted-foreground">
                <Rss className="mx-auto mb-2 size-5" />
                @{person.handle} is waiting for its first background sync.
                <span className="mt-1 block text-xs">
                  New profiles are picked up within ten minutes.
                </span>
              </div>
            </div>
          ) : view === "notes" ? (
            content.notes.length ? (
              <div className="space-y-4">
                {content.notes.map((note) => {
                  const eng = engagementByTargetId.get(note.id);
                  const hasReplyAfterEng = Boolean(
                    eng &&
                    note.replyCount &&
                    note.replyCount > 0 &&
                    (eng.actionType === "comment" || eng.actionType === "reply"),
                  );

                  return (
                    <NoteCard
                      key={note.id}
                      note={note}
                      person={person}
                      profile={profile}
                      engagementBadge={eng ? formatEngagementAction(eng) : undefined}
                      engagedBack={hasReplyAfterEng}
                      onImageClick={setSelectedImage}
                    />
                  );
                })}
              </div>
            ) : (
              <ContentEmpty kind="notes" />
            )
          ) : content.posts.length ? (
            <div className="space-y-4">
              {content.posts.map((post) => {
                const eng = engagementByTargetId.get(post.id);

                return (
                  <PostCard
                    key={post.id}
                    post={post}
                    person={person}
                    profile={profile}
                    engagementBadge={eng ? formatEngagementAction(eng) : undefined}
                    onRestack={(p) =>
                      setScheduleRestack({
                        post: p,
                        authorName: profile.name || person.name,
                      })
                    }
                  />
                );
              })}
            </div>
          ) : (
            <ContentEmpty kind="posts" />
          )}
        </div>
      </div>

      <Dialog open={selectedImage !== null} onOpenChange={(open) => !open && setSelectedImage(null)}>
        <DialogContent className="max-w-6xl gap-0 overflow-hidden bg-slate-950 p-3 sm:p-4">
          <DialogTitle className="sr-only">Full-resolution note image</DialogTitle>
          <DialogDescription className="sr-only">
            Full-resolution image attached to {person.name}&apos;s note.
          </DialogDescription>
          {selectedImage && (
            <img
              src={selectedImage.url}
              alt={`Full-resolution image attached to ${person.name}'s note`}
              width={selectedImage.width ?? undefined}
              height={selectedImage.height ?? undefined}
              decoding="async"
              className="mx-auto max-h-[calc(100vh-4rem)] max-w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

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
    </main>
  );
}
