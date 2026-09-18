import {
  Clock,
  Heart,
  HelpCircle,
  MessageCircle,
  Repeat,
  Sparkles,
  Users,
} from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"

export function BadgeGuideDrawer({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-lg p-0 flex flex-col h-full bg-[#fbfaf8] dark:bg-stone-950 backdrop-blur-md overflow-hidden border-l border-stone-200 dark:border-stone-800"
      >
        <SheetHeader className="p-6 pb-4 border-b border-stone-200/80 bg-white dark:bg-stone-900 dark:border-stone-800 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-[#f15a3a]/10 text-[#f15a3a] shadow-2xs">
              <HelpCircle className="size-4.5" />
            </span>
            <div>
              <SheetTitle className="text-base font-bold text-stone-900 dark:text-stone-100">
                Badge &amp; Scoring Guide
              </SheetTitle>
              <SheetDescription className="text-xs text-stone-500 mt-0.5">
                Understand reciprocity badges, engagement scores, and relationship statuses.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section 1: Reciprocity Dynamic Badges */}
          <section className="space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#f15a3a]">
              <Sparkles className="size-3.5" />
              <span>Relationship Reciprocity Badges</span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              Appears on contact cards to immediately tell you the balance of conversation and who spoke last.
            </p>

            <div className="space-y-2.5">
              {/* Needs Reply */}
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800">
                    <span>📥</span>
                    <span>Needs your reply</span>
                  </span>
                  <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    High Priority
                  </span>
                </div>
                <p className="mt-2 text-xs text-amber-900/90 dark:text-amber-200/90 leading-relaxed">
                  They interacted with you (commented, liked, or restacked), but you have either never responded or their interaction is newer than your last outreach.
                </p>
                <div className="mt-2 text-[11px] font-medium text-amber-800 dark:text-amber-300 bg-amber-100/60 dark:bg-amber-900/30 rounded-lg px-2.5 py-1">
                  💡 <strong>Action:</strong> Open their Substack note or post to acknowledge their support or reply to their conversation.
                </div>
              </div>

              {/* Ball in their court */}
              <div className="rounded-xl border border-sky-200/80 bg-sky-50/60 p-3.5 dark:border-sky-900/50 dark:bg-sky-950/20">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-900 border border-sky-300 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800">
                    <span>📤</span>
                    <span>Ball in their court</span>
                  </span>
                  <span className="text-[11px] font-medium text-sky-700 dark:text-sky-400">
                    You Commented Last
                  </span>
                </div>
                <p className="mt-2 text-xs text-sky-900/90 dark:text-sky-200/90 leading-relaxed">
                  You reached out, commented, or replied to them most recently. The ball is in their court.
                </p>
                <div className="mt-2 text-[11px] font-medium text-sky-800 dark:text-sky-300 bg-sky-100/60 dark:bg-sky-900/30 rounded-lg px-2.5 py-1">
                  💡 <strong>Action:</strong> Avoid double-messaging too soon; give them space to reply.
                </div>
              </div>

              {/* Mutual circle */}
              <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-3.5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-900 border border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800">
                    <span>🔄</span>
                    <span>Mutual circle</span>
                  </span>
                  <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    Active Two-Way
                  </span>
                </div>
                <p className="mt-2 text-xs text-emerald-900/90 dark:text-emerald-200/90 leading-relaxed">
                  Both of you regularly engage with each other's work (inbound &gt; 0 and outbound &gt; 0).
                </p>
                <div className="mt-2 text-[11px] font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-100/60 dark:bg-emerald-900/30 rounded-lg px-2.5 py-1">
                  💡 <strong>Action:</strong> These are your core advocates. Keep the connection warm with periodic notes and replies.
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Engagement Score Calculation */}
          <section className="space-y-3 pt-2 border-t border-stone-200/80 dark:border-stone-800">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-stone-200">
              <Sparkles className="size-3.5 text-amber-500" />
              <span>Engagement Scoring Rules</span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              Scores reflect engagement <strong>received from</strong> another person on your content. Outbound actions are recorded separately and never inflate a person's inbound score.
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-stone-200/80 bg-white p-3 dark:border-stone-800 dark:bg-stone-900 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Heart className="size-3.5 text-rose-500" />
                  <span className="font-medium text-stone-800 dark:text-stone-200">Like</span>
                </div>
                <span className="font-bold text-stone-900 dark:text-stone-100 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-full">
                  1 pt
                </span>
              </div>

              <div className="rounded-xl border border-stone-200/80 bg-white p-3 dark:border-stone-800 dark:bg-stone-900 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Repeat className="size-3.5 text-violet-500" />
                  <span className="font-medium text-stone-800 dark:text-stone-200">Plain Restack</span>
                </div>
                <span className="font-bold text-stone-900 dark:text-stone-100 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-full">
                  2 pts
                </span>
              </div>

              <div className="rounded-xl border border-stone-200/80 bg-white p-3 dark:border-stone-800 dark:bg-stone-900 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Repeat className="size-3.5 text-purple-500" />
                  <span className="font-medium text-stone-800 dark:text-stone-200">Restack with Note</span>
                </div>
                <span className="font-bold text-stone-900 dark:text-stone-100 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-full">
                  3 pts
                </span>
              </div>

              <div className="rounded-xl border border-stone-200/80 bg-white p-3 dark:border-stone-800 dark:bg-stone-900 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircle className="size-3.5 text-emerald-500" />
                  <span className="font-medium text-stone-800 dark:text-stone-200">Comment or Reply</span>
                </div>
                <span className="font-bold text-stone-900 dark:text-stone-100 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-full">
                  3 pts
                </span>
              </div>
            </div>
          </section>

          {/* Section 3: Relationship Status (The Dot on Avatars) */}
          <section className="space-y-3 pt-2 border-t border-stone-200/80 dark:border-stone-800">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-stone-200">
              <Users className="size-3.5 text-stone-500" />
              <span>Relationship Status (Avatar Dots)</span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              The colored indicator at the bottom-right of each contact avatar represents your manually assigned relationship stage.
            </p>

            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2.5 rounded-xl border border-stone-200/70 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900">
                <span className="size-3 rounded-full bg-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-stone-900 dark:text-stone-100">New (Yellow)</p>
                  <p className="text-stone-500 text-[11px] mt-0.5">
                    Newly discovered contact or subscriber added to your circle.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-stone-200/70 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900">
                <span className="size-3 rounded-full bg-sky-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-stone-900 dark:text-stone-100">Active (Blue)</p>
                  <p className="text-stone-500 text-[11px] mt-0.5">
                    Ongoing dialogue or frequent engagement in notes and posts.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-stone-200/70 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900">
                <span className="size-3 rounded-full bg-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-stone-900 dark:text-stone-100">Close (Green)</p>
                  <p className="text-stone-500 text-[11px] mt-0.5">
                    Key relationships, close friends, or VIP supporters.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-stone-200/70 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900">
                <span className="size-3 rounded-full bg-stone-400 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-stone-900 dark:text-stone-100">Dormant (Gray)</p>
                  <p className="text-stone-500 text-[11px] mt-0.5">
                    Past connections with no ongoing conversation.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: Drift Status (Activity Recency) */}
          <section className="space-y-3 pt-2 border-t border-stone-200/80 dark:border-stone-800">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-stone-200">
              <Clock className="size-3.5 text-stone-500" />
              <span>Drift Status (Calculated Recency)</span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              Automatically calculated based on the timestamp of the last interaction:
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-stone-200/80 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
                <span className="font-bold text-emerald-700 dark:text-emerald-400">Active</span>
                <p className="text-[11px] text-stone-500 mt-0.5">Interacted within last 30 days.</p>
              </div>
              <div className="rounded-xl border border-stone-200/80 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
                <span className="font-bold text-amber-600 dark:text-amber-400">Drifting</span>
                <p className="text-[11px] text-stone-500 mt-0.5">Last interaction 30–90 days ago.</p>
              </div>
              <div className="rounded-xl border border-stone-200/80 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
                <span className="font-bold text-stone-500">Cold</span>
                <p className="text-[11px] text-stone-500 mt-0.5">No interaction in &gt; 90 days.</p>
              </div>
              <div className="rounded-xl border border-stone-200/80 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
                <span className="font-bold text-sky-600 dark:text-sky-400">New</span>
                <p className="text-[11px] text-stone-500 mt-0.5">No recorded interactions yet.</p>
              </div>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
