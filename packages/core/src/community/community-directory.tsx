import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ListFilter,
  ListPlus,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { communityColorClass } from "./community-fields";
import {
  CreateListDialog,
  DeleteListDialog,
  DeletePersonDialog,
  PersonDialog,
} from "./community-dialogs";
import { ProfileAvatar, formatEngagementSignal } from "./note-card";
import {
  COMMUNITY_STATUSES,
  COMMUNITY_STATUS_LABELS,
  DRIFT_STATUS_LABELS,
  type CommunityActionResult,
  type CommunityContentProfile,
  type CommunityData,
  type CommunityList,
  type CommunityPerson,
  type CommunityStatus,
  type DriftStatus,
} from "./types";

type ActiveFilter =
  | { kind: "all" }
  | { kind: "tag"; id: string }
  | { kind: "list"; id: string };

type EngagementFilter = "all" | "needs-engagement" | "recent" | "never";

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

const STATUS_CLASSES: Record<CommunityStatus, string> = {
  new: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/15 dark:text-sky-200",
  "reach-out": "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/15 dark:text-amber-200",
  contacted: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/25 dark:bg-violet-400/15 dark:text-violet-200",
  conversation: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-400/25 dark:bg-fuchsia-400/15 dark:text-fuchsia-200",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/15 dark:text-emerald-200",
  archived: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-400/25 dark:bg-slate-400/15 dark:text-slate-200",
};

const DRIFT_CLASSES: Record<DriftStatus, { badge: string; dot: string }> = {
  active: {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/15 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  drifting: {
    badge: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/15 dark:text-amber-200",
    dot: "bg-amber-500",
  },
  cold: {
    badge: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/15 dark:text-rose-200",
    dot: "bg-rose-500",
  },
  new: {
    badge: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/15 dark:text-sky-200",
    dot: "bg-sky-500",
  },
};

export function communityStatusClass(status: CommunityStatus) {
  return STATUS_CLASSES[status];
}

function PinViewButton({
  kind,
  sourceId,
  pinned,
  name,
}: {
  kind: "tag" | "list";
  sourceId: string;
  pinned: boolean;
  name: string;
}) {
  const fetcher = useFetcher<CommunityActionResult>();
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value={pinned ? "unpinView" : "pinView"} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-xs"
        disabled={fetcher.state !== "idle"}
        aria-label={`${pinned ? "Remove" : "Add"} ${name} ${pinned ? "from" : "to"} dashboard`}
        title={pinned ? "Remove from dashboard" : "Pin to dashboard"}
        className={pinned ? "text-violet-600" : "text-muted-foreground"}
      >
        {pinned ? <PinOff /> : <Pin />}
      </Button>
    </fetcher.Form>
  );
}

function QuickListAssignDropdown({
  person,
  allLists,
}: {
  person: CommunityPerson;
  allLists: CommunityList[];
}) {
  const fetcher = useFetcher<CommunityActionResult>();
  const assignedIds = new Set(person.lists.map((l) => l.id));

  function toggleList(listId: string, currentlyAssigned: boolean) {
    fetcher.submit(
      {
        intent: "togglePersonList",
        personId: person.id,
        listId,
        included: String(!currentlyAssigned),
      },
      { method: "post" },
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-6 gap-1 px-2 text-xs font-medium"
        >
          <Plus className="size-3" />
          Lists
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {allLists.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No lists created yet.
          </p>
        ) : (
          allLists.map((list) => {
            const isAssigned = assignedIds.has(list.id);
            return (
              <DropdownMenuItem
                key={list.id}
                onClick={() => toggleList(list.id, isAssigned)}
                className="flex items-center justify-between text-xs"
              >
                <span>{list.name}</span>
                {isAssigned && <Check className="size-3.5 text-primary" />}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PersonCard({
  person,
  profile,
  allLists,
  onEdit,
}: {
  person: CommunityPerson;
  profile?: CommunityContentProfile;
  allLists: CommunityList[];
  onEdit: () => void;
}) {
  const signal = formatEngagementSignal(person.lastEngagedAt);
  const displayName = profile?.name ?? person.name;

  return (
    <Card>
      <CardHeader className="grid grid-cols-[auto_1fr_auto] items-start gap-3 pb-3">
        <ProfileAvatar
          name={displayName}
          photoUrl={profile?.photoUrl}
          className="size-10 text-sm"
        />
        <div className="min-w-0">
          <CardTitle className="truncate text-sm font-semibold">{displayName}</CardTitle>
          <a
            href={person.profileUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="truncate">@{person.handle}</span>
            <ArrowUpRight className="size-3" />
          </a>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={`Edit ${displayName}`}
          onClick={onEdit}
        >
          <Pencil />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border",
              signal.status === "active"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/15 dark:text-emerald-300"
                : signal.status === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/15 dark:text-amber-200"
                  : "border-border bg-muted text-muted-foreground",
            )}
          >
            {signal.text}
          </span>

          {person.driftStatus && DRIFT_CLASSES[person.driftStatus] && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border capitalize",
                DRIFT_CLASSES[person.driftStatus].badge,
              )}
            >
              <span className={cn("size-1.5 rounded-full", DRIFT_CLASSES[person.driftStatus].dot)} />
              {person.driftStatus}
            </span>
          )}

          {typeof person.interactionCount === "number" && person.interactionCount > 0 && (
            <span className="inline-flex items-center rounded-full border border-border/80 bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {person.interactionCount} {person.interactionCount === 1 ? "touchpoint" : "touchpoints"}
            </span>
          )}

          {signal.lastEngagedText && (
            <span className="inline-flex items-center rounded-full border border-border/80 bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {signal.lastEngagedText}
            </span>
          )}

          {person.status && (
            <Badge variant="outline" className={cn("border text-[11px]", communityStatusClass(person.status))}>
              {COMMUNITY_STATUS_LABELS[person.status]}
            </Badge>
          )}
        </div>

        {profile?.bio ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-foreground/80">{profile.bio}</p>
        ) : person.notes ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{person.notes}</p>
        ) : null}

        {person.notes && profile?.bio && (
          <p className="line-clamp-1 text-[11px] text-muted-foreground italic">Note: {person.notes}</p>
        )}

        {person.publicationUrl && (
          <a
            href={person.publicationUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <BookOpen className="size-3.5 shrink-0" />
            <span className="truncate">
              {new URL(person.publicationUrl).hostname.replace(/^www\./, "")}
            </span>
            <ArrowUpRight className="size-3 shrink-0" />
          </a>
        )}

        {person.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {person.tags.map((tag) => (
              <Badge key={tag.id} variant="outline" className={cn("border text-[10px]", communityColorClass(tag.color))}>
                {tag.name}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
          <div className="flex flex-wrap items-center gap-1 min-w-0">
            {person.lists.length > 0 ? (
              person.lists.map((list) => (
                <Badge key={list.id} variant="secondary" className="text-[11px]">
                  {list.name}
                </Badge>
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground/70">No lists assigned</span>
            )}
          </div>
          <QuickListAssignDropdown person={person} allLists={allLists} />
        </div>

        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to={`/app/community/${person.id}`}>
            <Rss /> Latest content
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function CommunityDirectory({ data }: { data: CommunityData }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CommunityStatus | "all" | "none">("all");
  const [engagementFilter, setEngagementFilter] = useState<EngagementFilter>("all");
  const [filter, setFilter] = useState<ActiveFilter>({ kind: "all" });
  const [addingPerson, setAddingPerson] = useState(false);
  const [editingPerson, setEditingPerson] = useState<CommunityPerson | null>(null);
  const [deletingPerson, setDeletingPerson] = useState<CommunityPerson | null>(null);
  const [addingList, setAddingList] = useState(false);
  const [deletingList, setDeletingList] = useState<CommunityList | null>(null);

  const syncFetcher = useFetcher<CommunityActionResult>();

  useEffect(() => {
    if (syncFetcher.data?.ok && syncFetcher.data.intent === "syncRelationships") {
      const stats = syncFetcher.data.stats;
      console.log(
        "%c[StackedHQ CRM] ✅ Manual relationship sync completed!",
        "color: #10b981; font-weight: bold;",
        `Processed ${stats.processedItems} activity items -> ${stats.newInteractions} new touchpoints, ${stats.newPeople} new people discovered, ${stats.updatedPeople} profiles refreshed.`,
        stats,
      );
      toast.success(
        `Synced: ${stats.newInteractions} new interactions, ${stats.newPeople} new people`,
      );
    } else if (syncFetcher.data && !syncFetcher.data.ok) {
      console.error(
        "%c[StackedHQ CRM] ❌ Manual relationship sync failed:",
        "color: #ef4444; font-weight: bold;",
        syncFetcher.data.message,
      );
      toast.error(syncFetcher.data.message);
    }
  }, [syncFetcher.data]);

  function handleManualSync() {
    console.log(
      "%c[StackedHQ CRM] 🚀 Starting manual relationship sync from Substack activity...",
      "color: #3b82f6; font-weight: bold;",
    );
    syncFetcher.submit({ intent: "syncRelationships" }, { method: "post" });
  }

  const profilesByPerson = useMemo(() => {
    const map = new Map<string, CommunityContentProfile>();
    if (data.snapshots) {
      for (const snapshot of data.snapshots) {
        if (snapshot.content?.profile) {
          map.set(snapshot.personId, snapshot.content.profile);
        }
      }
    }
    return map;
  }, [data.snapshots]);

  const visiblePeople = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en");
    return data.people.filter((person) => {
      const matchesQuery =
        !normalizedQuery ||
        person.name.toLocaleLowerCase("en").includes(normalizedQuery) ||
        person.handle.toLocaleLowerCase("en").includes(normalizedQuery) ||
        (person.publicationUrl?.toLocaleLowerCase("en").includes(normalizedQuery) ?? false) ||
        person.tags.some((tag) => tag.name.toLocaleLowerCase("en").includes(normalizedQuery));

      const matchesStatus =
        status === "all" ||
        (status === "none" ? person.status === null : person.status === status);

      const matchesFilter =
        filter.kind === "all" ||
        (filter.kind === "tag" && person.tags.some((tag) => tag.id === filter.id)) ||
        (filter.kind === "list" && person.lists.some((list) => list.id === filter.id));

      let matchesEngagement = true;
      if (engagementFilter === "never") {
        matchesEngagement = person.lastEngagedAt === null;
      } else if (engagementFilter === "recent") {
        matchesEngagement =
          person.lastEngagedAt !== null &&
          Date.now() - Date.parse(person.lastEngagedAt) <= FIVE_DAYS_MS;
      } else if (engagementFilter === "needs-engagement") {
        matchesEngagement =
          person.lastEngagedAt === null ||
          Date.now() - Date.parse(person.lastEngagedAt) > FIVE_DAYS_MS;
      }

      return matchesQuery && matchesStatus && matchesFilter && matchesEngagement;
    });
  }, [data.people, engagementFilter, filter, query, status]);

  const needsEngagementCount = data.people.filter(
    (p) => !p.lastEngagedAt || Date.now() - Date.parse(p.lastEngagedAt) > FIVE_DAYS_MS,
  ).length;

  const activeRelationships = data.people.filter(
    (person) =>
      person.driftStatus === "active" ||
      (person.lastEngagedAt !== null &&
        Date.now() - Date.parse(person.lastEngagedAt) <= FIVE_DAYS_MS),
  ).length;

  const driftingRelationships = data.people.filter(
    (person) => person.driftStatus === "drifting",
  ).length;

  return (
    <main className="px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight">
              Lists & Members
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage the authors on your lists, view engagement history, and keep track of who to follow up with.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={syncFetcher.state !== "idle"}
              onClick={handleManualSync}
              title="Sync latest interactions and relationships from Substack activity"
            >
              <RefreshCw className={cn("size-3.5", syncFetcher.state !== "idle" && "animate-spin")} />
              {syncFetcher.state !== "idle" ? "Syncing..." : "Sync activity"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setAddingList(true)}>
              <ListPlus />New list
            </Button>
            <Button type="button" size="sm" onClick={() => setAddingPerson(true)}>
              <UserPlus />Add member
            </Button>
          </div>
        </header>

        {/* Primary List Tabs */}
        <div className="mt-6 flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
          <button
            type="button"
            onClick={() => setFilter({ kind: "all" })}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              filter.kind === "all"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <UsersRound className="size-3.5" />
            All members
            <span className="ml-1 rounded-full bg-background/20 px-1.5 py-0.2 text-[10px]">
              {data.people.length}
            </span>
          </button>

          {data.lists.map((list) => (
            <div
              key={list.id}
              className={cn(
                "inline-flex items-center rounded-lg pr-1 transition-colors",
                filter.kind === "list" && filter.id === list.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => setFilter({ kind: "list", id: list.id })}
                className="px-3 py-1.5 text-xs font-medium"
              >
                {list.name}
                <span className="ml-1.5 opacity-80 text-[10px]">
                  {list.memberCount}
                </span>
              </button>
              <PinViewButton kind="list" sourceId={list.id} pinned={list.pinned} name={list.name} />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="opacity-70 hover:opacity-100"
                aria-label={`Delete ${list.name}`}
                onClick={() => setDeletingList(list)}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2.5 text-xs text-muted-foreground"
            onClick={() => setAddingList(true)}
          >
            <Plus className="size-3.5" />
            Add list
          </Button>
        </div>

        <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Community stats">
          {[
            { label: "Members", value: data.people.length, detail: "in your CRM", dot: "bg-violet-500" },
            { label: "Active", value: activeRelationships, detail: "touchpoint < 14d", dot: "bg-emerald-500" },
            { label: "Drifting", value: driftingRelationships, detail: "no touchpoint 15–45d", dot: "bg-amber-500" },
            { label: "Lists created", value: data.lists.length, detail: `${data.tags.length} custom tags`, dot: "bg-sky-500" },
          ].map((stat) => (
            <Card key={stat.label} size="sm">
              <CardContent>
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span className={cn("size-1.5 rounded-full", stat.dot)} />{stat.label}
                </p>
                <p className="mt-1 font-heading text-xl font-semibold">{stat.value}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{stat.detail}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[15rem_1fr]">
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardHeader><CardTitle className="text-sm">Filter by tag</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {data.tags.map((tag) => (
                  <div
                    key={tag.id}
                    className={cn(
                      "inline-flex items-center rounded-lg border text-xs",
                      filter.kind === "tag" && filter.id === tag.id
                        ? "ring-2 ring-primary ring-offset-1"
                        : "",
                      communityColorClass(tag.color),
                    )}
                  >
                    <button
                      type="button"
                      className="px-2 py-1 text-xs font-medium"
                      onClick={() => setFilter({ kind: "tag", id: tag.id })}
                    >
                      {tag.name}
                    </button>
                    <span className="border-l border-current/15 pr-0.5 pl-0.5">
                      <PinViewButton kind="tag" sourceId={tag.id} pinned={tag.pinned} name={tag.name} />
                    </span>
                  </div>
                ))}
                {data.tags.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Tags appear here as you add them to members.
                  </p>
                )}
              </CardContent>
            </Card>
          </aside>

          <div>
            <Card>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="Search members by name, handle, or tag…"
                    className="pl-9"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={engagementFilter}
                    onChange={(e) => setEngagementFilter(e.currentTarget.value as EngagementFilter)}
                    aria-label="Filter by engagement"
                    className="h-9 rounded-lg border border-input bg-background px-3 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="all">All engagement</option>
                    <option value="needs-engagement">Needs engagement (&gt; 5d)</option>
                    <option value="recent">Engaged recently (&lt; 5d)</option>
                    <option value="never">Never engaged</option>
                  </select>

                  <select
                    value={status}
                    onChange={(event) => setStatus(event.currentTarget.value as CommunityStatus | "all" | "none")}
                    aria-label="Filter by status"
                    className="h-9 rounded-lg border border-input bg-background px-3 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="all">All statuses</option>
                    <option value="none">No status</option>
                    {COMMUNITY_STATUSES.map((option) => (
                      <option key={option} value={option}>{COMMUNITY_STATUS_LABELS[option]}</option>
                    ))}
                  </select>
                </div>
              </CardContent>
            </Card>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{visiblePeople.length}</span>{" "}
                {visiblePeople.length === 1 ? "member" : "members"}
              </p>
              {filter.kind !== "all" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilter({ kind: "all" })}
                >
                  Show all members
                </Button>
              )}
            </div>

            {visiblePeople.length > 0 ? (
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                {visiblePeople.map((person) => (
                  <PersonCard
                    key={person.id}
                    person={person}
                    profile={profilesByPerson.get(person.id)}
                    allLists={data.lists}
                    onEdit={() => setEditingPerson(person)}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
                <UsersRound className="mx-auto size-5 text-muted-foreground" />
                <h2 className="mt-3 text-sm font-semibold">
                  {data.people.length ? "No members match these filters" : "Your lists are ready for members"}
                </h2>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  {data.people.length
                    ? "Try adjusting your search query or engagement filter."
                    : "Add writers and friends from Substack or directly here to build your lists."}
                </p>
                {!data.people.length && (
                  <Button type="button" size="sm" className="mt-4" onClick={() => setAddingPerson(true)}>
                    <UserPlus />Add first member
                  </Button>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {addingPerson && (
        <PersonDialog
          person={null}
          tags={data.tags}
          lists={data.lists}
          onClose={() => setAddingPerson(false)}
        />
      )}
      {editingPerson && (
        <PersonDialog
          person={editingPerson}
          tags={data.tags}
          lists={data.lists}
          onClose={() => setEditingPerson(null)}
          onDelete={setDeletingPerson}
        />
      )}
      {deletingPerson && (
        <DeletePersonDialog
          person={deletingPerson}
          onClose={() => setDeletingPerson(null)}
        />
      )}
      {addingList && <CreateListDialog onClose={() => setAddingList(false)} />}
      {deletingList && (
        <DeleteListDialog list={deletingList} onClose={() => setDeletingList(null)} />
      )}
    </main>
  );
}
