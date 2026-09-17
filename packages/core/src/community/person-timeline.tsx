import { useMemo, useState } from "react";
import { ArrowUpRight, Heart, MessageSquareText, Repeat2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildConversationTimeline, timelineDate, timelineLink } from "./conversation-timeline";
import type { CommunityInteraction, CommunityPerson } from "./types";
import { NoteCard, PostCard } from "./note-card";
import { interactionContent } from "./interaction-content";

function SavedTarget({ items }: { items: CommunityInteraction[] }) {
  const content = items.map(interactionContent).find((item) => item !== null);
  if (!content) return <p className="px-4 pt-3 text-xs text-muted-foreground">Target content was not captured. Open the thread on Substack to view it.</p>;
  return <div className="p-3 sm:p-4">{content.kind === "post"
    ? <PostCard post={content.post} profile={content.profile} />
    : <NoteCard note={content.note} profile={content.profile} readOnly openUrl={content.note.url || null} />}</div>;
}

const ACTIONS: Record<CommunityInteraction["actionType"], string> = {
  comment: "Commented", reply: "Replied", like: "Liked", restack: "Restacked", subscribe: "Subscribed / followed", mention: "Mentioned you", other: "Interacted",
};

function Interaction({ item, person }: { item: CommunityInteraction; person: CommunityPerson }) {
  const [expanded, setExpanded] = useState(false);
  const outgoing = item.direction === "outbound";
  const Icon = item.actionType === "like" ? Heart : item.actionType === "restack" ? Repeat2 : item.actionType === "subscribe" ? UserPlus : MessageSquareText;
  const link = timelineLink(item.targetUrl);
  return (
    <li className={cn("rounded-lg border p-3 sm:p-4", outgoing ? "ml-4 border-violet-200/70 bg-violet-50/60 dark:border-violet-400/20 dark:bg-violet-400/5 sm:ml-10" : "mr-4 border-border bg-muted/30 sm:mr-10")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-semibold">{outgoing ? "You" : person.name}</span>
          <span className="text-muted-foreground">{ACTIONS[item.actionType]}</span>
        </div>
        <time dateTime={item.occurredAt} className="text-[11px] text-muted-foreground">{timelineDate(item.occurredAt)}</time>
      </div>
      {item.body ? (
        <>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{expanded || item.body.length <= 1200 ? item.body : item.body.slice(0, 1200) + "…"}</p>
          {item.body.length > 1200 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="mt-2 text-xs font-medium text-violet-600 hover:underline dark:text-violet-300">{expanded ? "Show less" : "Read full comment"}</button>}
        </>
      ) : (item.actionType === "comment" || item.actionType === "reply") && <p className="mt-2 text-xs text-muted-foreground">Comment text has not been captured yet.</p>}
      {link && <a href={link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">View on Substack <ArrowUpRight className="size-3" /></a>}
    </li>
  );
}

export function ConversationTimeline({ person, interactions, hasMore, onLoadMore, loading }: {
  person: CommunityPerson; interactions: CommunityInteraction[]; hasMore: boolean; onLoadMore: () => void; loading: boolean;
}) {
  const groups = useMemo(() => buildConversationTimeline(interactions), [interactions]);
  return (
    <section aria-label="Relationship timeline">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-sm font-semibold">Your history with {person.name}</h2><p className="mt-1 text-xs text-muted-foreground">Latest {interactions.length} saved touchpoints · newest threads first, oldest exchanges first.</p></div>
      </div>
      {!groups.length ? <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center"><MessageSquareText className="mx-auto size-6 text-muted-foreground" /><h3 className="mt-3 text-sm font-semibold">Your conversation history starts here</h3><p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Browse Substack activity and conversations with the companion enabled, or sync activity from Community. Captured interactions will appear here.</p></div> : (
        <div className="space-y-5">{groups.map((group) => <article key={group.id} className="overflow-hidden rounded-xl border border-border bg-background">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-4 py-3">
            <div><h3 className="text-sm font-semibold">{group.title}</h3><p className="mt-0.5 text-[11px] text-muted-foreground">{group.items.length} captured {group.items.length === 1 ? "touchpoint" : "touchpoints"}</p></div>
            {group.url && <a href={group.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium">Open thread <ArrowUpRight className="size-3.5" /></a>}
          </header>
          <SavedTarget items={group.items} />
          <ol className="space-y-3 p-3 sm:p-4">{group.items.map((item) => <Interaction key={item.id} item={item} person={person} />)}</ol>
        </article>)}</div>
      )}
      {hasMore && <div className="mt-5 text-center"><Button variant="outline" disabled={loading} onClick={onLoadMore}>{loading ? "Loading history…" : "Show older interactions"}</Button><p className="mt-2 text-xs text-muted-foreground">Threads may be partial until older interactions are loaded.</p></div>}
    </section>
  );
}
