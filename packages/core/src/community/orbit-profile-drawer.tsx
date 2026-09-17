import { useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { Tabs } from "radix-ui";
import { Dialog, DialogTitle, DialogDescription, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ConversationTimeline } from "./person-timeline";
import { timelineDate, timelineLink, buildConversationTimeline } from "./conversation-timeline";
import type { OrbitHistory } from "./orbit-data";
import type { CommunityContentProfile, CommunityInteraction, CommunityPerson } from "./types";

export function OrbitProfileDetails({ person, profile, saved, interactions, hasMore, historyCapped, loading, onLoadMore }: {
  person: CommunityPerson; profile?: CommunityContentProfile; saved?: OrbitHistory; interactions: CommunityInteraction[];
  hasMore: boolean; historyCapped: boolean; loading: boolean; onLoadMore: () => void;
}) {
  const [tab, setTab] = useState("summary");
  const avatar = profile?.photoUrl ?? saved?.preview.find((item) => item.avatarUrl)?.avatarUrl;
  const incoming = interactions.find((item) => item.direction === "inbound" && item.body);
  const outgoing = interactions.find((item) => item.direction === "outbound" && item.body);
  const profileUrl = timelineLink(person.profileUrl);
  return <div className="grid min-h-0 min-w-0 flex-1 text-base md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)]">
    <aside className="border-b border-border bg-[#f5f1eb] p-6 dark:bg-muted/30 md:overflow-y-auto md:border-b-0 md:border-r sm:p-8">
      <div className="mb-5 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary bg-muted p-1" style={{ width: 80, height: 80 }}>
        {avatar ? <img src={avatar} alt="" width={68} height={68} className="h-full w-full rounded-full object-cover" style={{ width: 68, height: 68, objectFit: "cover" }} /> : <span className="text-xl font-semibold text-muted-foreground">{person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span>}
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">{person.name}</h2>
      {profileUrl ? <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-[#e45235]">@{person.handle}<ArrowUpRight className="size-3" /></a> : <p className="text-sm">@{person.handle}</p>}
      {profile?.bio && <p className="mt-5 whitespace-pre-wrap break-words text-sm italic leading-6 text-muted-foreground">{profile.bio}</p>}
      <p className="mt-5 text-xs text-muted-foreground">{saved?.total ?? 0} saved touchpoints · {saved?.inbound ?? 0} inbound · {saved?.outbound ?? 0} outbound</p>
      {saved?.latestAt && <p className="mt-2 text-xs text-muted-foreground">Last interaction {timelineDate(saved.latestAt)}</p>}
      <Separator className="my-6" />
      <dl className="space-y-4 text-sm">
        <div><dt className="text-xs text-muted-foreground">Added to your CRM</dt><dd className="mt-1">{timelineDate(person.createdAt)}</dd></div>
        {person.status && <div><dt className="text-xs text-muted-foreground">Your relationship status</dt><dd className="mt-1 capitalize">{person.status.replace(/-/g, " ")}</dd></div>}
        <div><dt className="text-xs text-muted-foreground">Lists</dt><dd className="mt-2 flex flex-wrap gap-2">{person.lists.length ? person.lists.map((list) => <Badge key={list.id} variant="secondary" className="h-auto whitespace-normal">{list.name}</Badge>) : "No lists yet"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Your tags</dt><dd className="mt-2 flex flex-wrap gap-2">{person.tags.length ? person.tags.map((tag) => <Badge key={tag.id} variant="outline" className="h-auto whitespace-normal">{tag.name}</Badge>) : "No tags yet"}</dd></div>
      </dl>
      <div className="mt-8 space-y-2">{profileUrl && <Button asChild size="lg" className="h-auto min-h-9 w-full whitespace-normal py-2.5"><a href={profileUrl} target="_blank" rel="noopener noreferrer"><ArrowUpRight /> Open {person.name}’s Substack</a></Button>}
      <Button asChild variant="ghost" className="h-auto w-full whitespace-normal py-2"><Link to={`/app/community/${encodeURIComponent(person.id)}`}>Open full profile & content →</Link></Button></div>
    </aside>
    <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 min-w-0 flex-col bg-[#fcfaf7] dark:bg-background">
      <Tabs.List aria-label="Profile sections" className="flex min-h-16 shrink-0 flex-wrap items-center gap-1 border-b border-border px-4 py-3 pr-14 sm:px-6 sm:pr-14">
        {[{ id: "summary", name: "Summary" }, { id: "conversation", name: `Conversation (${buildConversationTimeline(interactions).length}${hasMore || historyCapped ? "+" : ""})` }, { id: "notes", name: "Your Notes" }].map((item) => <Tabs.Trigger key={item.id} value={item.id} asChild><Button variant={tab === item.id ? "secondary" : "ghost"} size="sm">{item.name}</Button></Tabs.Trigger>)}
      </Tabs.List>
      <div className="min-h-0 flex-1 p-5 md:overflow-y-auto sm:p-8">
        <Tabs.Content value="summary" className="space-y-6 outline-none">
          <div><h3 className="text-base font-semibold">Your relationship at a glance</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{saved?.total ?? 0} captured touchpoints, including {saved?.comments ?? 0} comments and replies. This view shows saved data—not an AI-generated summary.</p></div>
          {incoming && <div className="border-t border-border pt-5"><h4 className="mb-3 text-xs font-semibold text-muted-foreground">Latest captured message from {person.name}</h4><blockquote className="whitespace-pre-wrap break-words text-sm leading-7">{incoming.body}</blockquote><p className="mt-3 text-xs text-muted-foreground">{timelineDate(incoming.occurredAt)}</p></div>}
          {outgoing && <div className="border-t border-border pt-5"><h4 className="mb-3 text-xs font-semibold text-muted-foreground">Your latest captured message</h4><blockquote className="whitespace-pre-wrap break-words text-sm leading-7">{outgoing.body}</blockquote><p className="mt-3 text-xs text-muted-foreground">{timelineDate(outgoing.occurredAt)}</p></div>}
          {!incoming && !outgoing && <p className="text-sm text-muted-foreground">No message text in the loaded history yet. Check Conversation for saved activity.</p>}
          {(hasMore || historyCapped) && <p className="text-xs text-muted-foreground">Message previews are from the loaded history. Older messages may be available in Conversation.</p>}
        </Tabs.Content>
        <Tabs.Content value="conversation" className="outline-none"><ConversationTimeline person={person} interactions={interactions} hasMore={hasMore} onLoadMore={onLoadMore} loading={loading} />{historyCapped && <p className="mt-4 text-xs text-muted-foreground">Showing the latest 1,000 touchpoints. Older history remains stored.</p>}</Tabs.Content>
        <Tabs.Content value="notes" className="outline-none"><h3 className="text-base font-semibold">Your private CRM note</h3><p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">{person.notes || "You haven’t added a note for this person yet."}</p><Link to="/app/community" className="mt-5 inline-block text-xs font-medium text-[#e45235]">Edit notes in Lists & Members →</Link></Tabs.Content>
      </div>
    </Tabs.Root>
  </div>;
}

export function OrbitProfileDrawer(props: Parameters<typeof OrbitProfileDetails>[0] & { onClose: () => void }) {
  return <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}><DialogContent variant="drawer" aria-describedby="orbit-profile-description">
      <DialogTitle className="sr-only">{props.person.name}’s relationship profile</DialogTitle>
      <DialogDescription id="orbit-profile-description" className="sr-only">Saved profile, conversation history, and your private CRM note.</DialogDescription>
      <OrbitProfileDetails {...props} />
  </DialogContent></Dialog>;
}
