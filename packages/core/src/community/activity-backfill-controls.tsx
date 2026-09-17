import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronDown, Download, LoaderCircle, Pause } from "lucide-react";
import { timelineDate } from "./conversation-timeline";
import type { BackfillJob } from "./activity-backfill";
import type { action } from "../../routes/app.orbit";

export function ActivityBackfillControls({ job }: { job: BackfillJob | null }) {
  const fetcher = useFetcher<typeof action>();
  const [enabled, setEnabled] = useState(false);
  const busy = fetcher.state !== "idle";
  const error = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  useEffect(() => {
    if (!enabled || busy || error || job?.status !== "running") return;
    const delay = Math.max(1000, job.next_request_at - Date.now(), job.lease_until - Date.now());
    const timer = setTimeout(() => { void fetcher.submit({ intent: "backfillStep" }, { method: "post", action: "/app/orbit" }); }, delay);
    return () => clearTimeout(timer);
  }, [enabled, busy, error, job, fetcher]);
  const send = (intent: string) => {
    setEnabled(intent !== "backfillPause");
    void fetcher.submit({ intent }, { method: "post", action: "/app/orbit" });
  };
  const active = enabled && job?.status === "running";
  const failed = Boolean(error || job?.error);
  const label = failed ? "Import paused" : job?.status === "complete" ? "History imported" : active ? "Importing history" : job ? "Import paused" : "Import history";
  const Icon = active ? LoaderCircle : job?.status === "complete" ? Check : job ? Pause : Download;
  return <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-9 rounded-full border-black/[0.08] bg-white/80 text-xs shadow-none dark:border-border dark:bg-card">
        <Icon className={active ? "size-3.5 animate-spin text-[#f15a3a]" : "size-3.5 text-[#f15a3a]"} />
        <span className={failed ? "text-destructive" : ""}>{label}</span>
        {job && <span className="border-l border-border pl-2 text-muted-foreground">{job.items.toLocaleString()} items</span>}
        <ChevronDown className="size-3 text-muted-foreground" />
      </Button></PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Your notification history</h2>
        <p className="text-xs leading-5 text-muted-foreground">Import up to 3 months of saved activity. A 2-second pause between pages keeps requests spaced out.</p>
        {job && <div className="space-y-3 border-y border-border py-3 text-xs">
          <p className="font-medium">{job.status === "complete" ? job.finish_reason === "cutoff" ? "Three-month date boundary reached" : "No more history available from Substack" : active ? busy ? "Saving the current page…" : "Importing · keep Orbit open" : "Progress saved · resume when ready"}</p>
          <dl className="grid grid-cols-2 gap-3">{[["Pages saved", job.pages], ["Notification items", job.items], ["New touchpoints", job.new_interactions], ["Enriched touchpoints", job.enriched_interactions], ["New people", job.new_people]].map(([title, value]) => <div key={title}><dt className="text-muted-foreground">{title}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{value.toLocaleString()}</dd></div>)}</dl>
          <p className="leading-5 text-muted-foreground">Target: {timelineDate(job.cutoff)}{job.oldest_at && <><br />Oldest captured update: {timelineDate(job.oldest_at)}</>}</p>
        </div>}
        <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-[11px] leading-5 text-muted-foreground">
          <h3 className="font-semibold text-foreground">What this import covers</h3>
          <p><span className="font-medium text-foreground">Imports:</span> Up to 3 months of notification history available from Substack, including likes, restacks, comments, replies, mentions, and subscription/follow notifications when present. Saves identifiable people and the target title, URL, text, and counts included in each response.</p>
          <p><span className="font-medium text-foreground">Does not import:</span> A person's complete likes or reading history, every liker or follower in grouped notifications, complete subscriber/follower lists, full conversation reply trees, private messages, or full article bodies, images, and rich formatting not captured by this import.</p>
          <p>This is a notification-based record, not a complete activity archive. Substack may return less than 3 months of history, and missing people or content cannot be reconstructed from these responses.</p>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">Your cursor is saved after each page. Keep Orbit open while importing. Closing it stops further requests; a page already in progress may finish.</p>
      </PopoverContent>
    </Popover>
    {!job || job.status === "complete" ? <Button disabled={busy} size="sm" variant="outline" className="h-9 rounded-full bg-white/80 text-xs dark:bg-card" onClick={() => send("backfillStart")}>{job ? "Import again" : "Start import"}</Button> : <Button disabled={busy} size="sm" variant="outline" className="h-9 rounded-full bg-white/80 text-xs dark:bg-card" onClick={() => send(active ? "backfillPause" : "backfillResume")}>{busy ? "Saving…" : active ? "Pause" : "Resume"}</Button>}
    {failed && <p role="alert" className="w-full max-w-xl text-right text-xs leading-5 text-destructive">{error || job?.error}{job && job.next_request_at > Date.now() && <> Retry after {timelineDate(new Date(job.next_request_at).toISOString())}.</>}</p>}
  </div>;
}
