import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowDownLeft, ArrowUpRight, MessageCircle, Orbit, RefreshCw, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProfileAvatar } from "./note-card";
import { timelineDate } from "./conversation-timeline";
import { orbitExcerpt, selectOrbitPeople } from "./orbit-data";
import type { OrbitFilter, OrbitHistory, OrbitSort } from "./orbit-data";
import type { CommunityContentProfile, CommunityList, CommunityPerson } from "./types";

const FILTERS: { id: OrbitFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "conversations", label: "Conversations" },
  { id: "inbound", label: "Inbound" }, { id: "outbound", label: "Outbound" }, { id: "empty", label: "No history yet" },
];
const ACTION_LABELS: Record<string, string> = { like: "Liked your work", restack: "Restacked your work", subscribe: "Subscribed / followed", mention: "Mentioned you", comment: "Left a comment", reply: "Replied", other: "Interacted" };

export function OrbitPersonCard({ person, saved, profile }: { person: CommunityPerson; saved?: OrbitHistory; profile?: CommunityContentProfile }) {
  const incoming = saved?.preview.find((item) => item.direction === "inbound" && item.body);
  const outgoing = saved?.preview.find((item) => item.direction === "outbound" && item.body);
  const avatar = profile?.photoUrl ?? saved?.preview.find((item) => item.avatarUrl)?.avatarUrl;
  return (
    <article className="flex h-full flex-col rounded-2xl border border-black/[0.08] bg-white/90 p-5 shadow-[0_2px_8px_rgba(50,35,20,0.025)] transition-shadow hover:shadow-md dark:border-border dark:bg-card sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <Link to={`/app/orbit?person=${encodeURIComponent(person.id)}`} preventScrollReset className="group flex min-w-0 items-center gap-3">
          <div className="shrink-0 rounded-full border-2 border-[#f15a3a]/70 p-0.5"><ProfileAvatar name={person.name} photoUrl={avatar} className="size-10" /></div>
          <div className="min-w-0"><h2 className="truncate text-sm font-semibold group-hover:text-[#e45235]">{person.name}</h2><p className="mt-0.5 truncate text-xs text-muted-foreground">@{person.handle}</p></div>
        </Link>
        <Link to={`/app/orbit?person=${encodeURIComponent(person.id)}`} preventScrollReset aria-label={`Open ${person.name}'s profile`} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowUpRight className="size-4" /></Link>
      </header>
      <div className="mt-5 flex-1 space-y-4">
        {incoming && <div><p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"><ArrowDownLeft className="size-3" /> Last heard from {person.name}</p><blockquote className="whitespace-pre-wrap break-words text-sm leading-6">{orbitExcerpt(incoming.body!)}</blockquote>{incoming.title && <p className="mt-1 text-xs text-muted-foreground">On {orbitExcerpt(incoming.title, 90)}</p>}</div>}
        {outgoing && <div className="rounded-lg bg-[#faf4ee] px-3 py-2.5 dark:bg-muted/40"><p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Your latest reply / comment</p><p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{orbitExcerpt(outgoing.body!, 200)}</p></div>}
        {!incoming && !outgoing && <div><p className="text-sm leading-6">{saved?.preview[0] ? (saved.preview[0].direction === "outbound" ? `You: ${saved.preview[0].actionType}` : ACTION_LABELS[saved.preview[0].actionType] ?? "Saved interaction") : "No interactions captured yet."}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{profile?.bio ? orbitExcerpt(profile.bio, 220) : saved?.total ? "Open the timeline to see your saved relationship history." : "Browse conversations with the companion enabled to start collecting your history."}</p></div>}
        {person.notes && <p className="border-l-2 border-[#f15a3a]/30 pl-3 text-xs leading-5 text-muted-foreground"><span className="font-medium">Your note: </span>{orbitExcerpt(person.notes, 180)}</p>}
        {!!person.tags.length && <div className="flex flex-wrap gap-1.5">{person.tags.slice(0, 4).map((tag) => <span key={tag.id} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{tag.name}</span>)}</div>}
      </div>
      <footer className="mt-5 border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>{saved?.total ?? 0} saved touchpoints</span><span>{saved?.inbound ?? 0} inbound · {saved?.outbound ?? 0} outbound</span></div>
        {saved?.latestAt && <p className="mt-1.5 text-[10px] text-muted-foreground">Last interaction {timelineDate(saved.latestAt)}</p>}
        <Link to={`/app/orbit?person=${encodeURIComponent(person.id)}`} preventScrollReset className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#df4d30] dark:text-orange-300">View relationship <ArrowUpRight className="size-3" /></Link>
      </footer>
    </article>
  );
}

export function OrbitOverview({ people, lists, history, profiles, onReload, reloading = false, importControls }: {
  people: CommunityPerson[]; lists: CommunityList[]; history: Record<string, OrbitHistory>; profiles: Record<string, CommunityContentProfile>;
  onReload?: () => void; reloading?: boolean; importControls?: ReactNode;
}) {
  const [query, setQuery] = useState(""); const [list, setList] = useState("all");
  const [filter, setFilter] = useState<OrbitFilter>("all"); const [sort, setSort] = useState<OrbitSort>("active");
  const [limit, setLimit] = useState(60);
  const visible = useMemo(() => selectOrbitPeople(people, history, query, list, filter, sort), [people, history, query, list, filter, sort]);
  const selectedList = lists.find((item) => item.id === list);
  const savedCount = Object.values(history).reduce((total, item) => total + item.total, 0);
  const lastSaved = Object.values(history).map((item) => item.savedAt).sort().at(-1);
  const collections = [{ id: "all", name: "Everyone" }, ...lists];
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(ellipse_at_top_right,rgba(255,210,189,0.35),transparent_65%)] bg-[#f5f1eb] px-4 py-7 dark:bg-background sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-white bg-white/75 px-4 py-2 text-xs font-medium dark:border-border dark:bg-card"><Orbit className="size-4 text-[#f15a3a]" /> Orbit <span className="ml-2 border-l border-border pl-3 text-muted-foreground">People & relationships</span></div>
          <div className="flex items-center gap-3">{lastSaved && <span title={timelineDate(lastSaved)} className="hidden text-xs text-muted-foreground sm:block">Latest saved data · {timelineDate(lastSaved).split(",")[0]}</span>}{onReload && <Button size="sm" variant="outline" className="rounded-full bg-white/80 dark:bg-card" disabled={reloading} onClick={onReload}><RefreshCw className={cn("size-3.5", reloading && "animate-spin")} /> Reload data</Button>}</div>
        </div>
        {importControls && <div className="mt-4 flex justify-end">{importControls}</div>}
        <header className="pb-8 pt-10 sm:pb-10 sm:pt-14">
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl xl:text-5xl"><span className="text-[#f15a3a]">{people.length}</span> {people.length === 1 ? "person" : "people"} in your orbit</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">The people behind the replies. Your conversations, all in one place.</p>
          <p className="mt-2 text-xs text-muted-foreground">{savedCount} saved touchpoints · {Object.values(history).filter((item) => item.comments > 0).length} people with captured conversations</p>
        </header>
        <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:gap-8">
          <aside aria-label="Orbit lists" className="lg:sticky lg:top-6">
            <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">{collections.map((collection, index) => {
              const members = collection.id === "all" ? people : people.filter((person) => person.lists.some((item) => item.id === collection.id));
              return <button key={collection.id} type="button" aria-pressed={list === collection.id} onClick={() => { setList(collection.id); setLimit(60); }} className={cn("min-w-44 rounded-2xl border p-3.5 text-left transition-colors lg:min-w-0", list === collection.id ? "border-black/20 bg-white shadow-sm dark:border-foreground/30 dark:bg-card" : "border-black/[0.06] bg-white/65 hover:bg-white dark:border-border dark:bg-card/50")}>
                <span className="flex items-center justify-between gap-3 text-xs font-medium"><span>{collection.name}</span><span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">{members.length}<span className={cn("size-1.5 rounded-full", index % 3 === 0 ? "bg-stone-400" : index % 3 === 1 ? "bg-[#f15a3a]" : "bg-sky-500")} /></span></span>
                <span className="mt-3 flex -space-x-2">{members.slice(0, 6).map((person) => <ProfileAvatar key={person.id} name={person.name} photoUrl={profiles[person.id]?.photoUrl ?? history[person.id]?.preview.find((item) => item.avatarUrl)?.avatarUrl} className="size-6 border-2 border-white text-[9px] dark:border-card" />)}{!members.length && <span className="text-[10px] text-muted-foreground">No people yet</span>}</span>
              </button>;
            })}</div>
            <Link to="/app/community" className="mt-3 inline-flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground">Manage lists & members <ArrowUpRight className="size-3" /></Link>
          </aside>
          <section aria-label="People in your orbit" className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{selectedList?.name ?? "Everyone"}<span className="ml-2 text-xs font-normal text-muted-foreground">· {visible.length} people</span></h2><label className="relative block w-full sm:w-64"><Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-muted-foreground" /><input aria-label="Search people and recent captured context" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(60); }} placeholder="Search people & recent context" className="h-9 w-full rounded-full border border-border/70 bg-white/85 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-[#f15a3a]/30 dark:bg-card" /></label></div>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-1 rounded-full border border-white bg-white/65 p-1 dark:border-border dark:bg-card" role="group" aria-label="Interaction filters">{FILTERS.map((option) => <button key={option.id} type="button" aria-pressed={filter === option.id} onClick={() => { setFilter(option.id); setLimit(60); }} className={cn("rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors", filter === option.id ? "bg-white text-[#e45235] shadow-sm dark:bg-muted" : "text-muted-foreground hover:text-foreground")}>{option.label}</button>)}</div><label className="flex items-center gap-2 rounded-full border border-white bg-white/85 px-3 py-2 text-[11px] dark:border-border dark:bg-card"><span className="text-muted-foreground">Sort:</span><select aria-label="Sort people" value={sort} onChange={(event) => { setSort(event.target.value as OrbitSort); setLimit(60); }} className="max-w-32 bg-transparent font-medium outline-none"><option value="active">Most interactions</option><option value="recent">Most recent</option><option value="name">Name</option></select></label></div>
            {visible.length ? <div className="grid gap-4 xl:grid-cols-2">{visible.slice(0, limit).map((person) => <OrbitPersonCard key={person.id} person={person} saved={history[person.id]} profile={profiles[person.id]} />)}</div> : <div className="rounded-2xl border border-dashed border-black/15 bg-white/60 px-6 py-14 text-center dark:border-border dark:bg-card"><Users className="mx-auto size-7 text-[#f15a3a]/70" /><h3 className="mt-4 text-sm font-semibold">{people.length ? "No people match this view" : "Your orbit starts with a conversation"}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{people.length ? "Try another list, search, or interaction filter." : "Browse Substack with the companion enabled, or add people from Lists & Members. Your saved history will appear here."}</p>{!!people.length && <button type="button" onClick={() => { setQuery(""); setFilter("all"); setList("all"); }} className="mt-4 text-xs font-medium text-[#df4d30]">Clear filters</button>}</div>}
            {visible.length > limit && <div className="mt-6 text-center"><Button variant="outline" className="rounded-full bg-white dark:bg-card" onClick={() => setLimit(limit + 60)}>Show more people ({visible.length - limit} remaining)</Button></div>}
            <p className="mt-6 text-[11px] leading-5 text-muted-foreground"><MessageCircle className="mr-1 inline size-3" /> Cards show captured messages, not AI summaries. Open a relationship for the full timeline. Search includes recent previews, not the entire archive.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
