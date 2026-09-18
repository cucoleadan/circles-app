import { useEffect, useState } from "react"
import { Archive, ExternalLink, Sparkles } from "lucide-react"

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import type { ListRecord, Person, TagRecord } from "../lib/types"
import { ContactDetailsTab } from "./contact-details-tab"
import { ProfileBreakdown } from "./profile-breakdown"
import { Timeline } from "./timeline"

const statusOptions = [
  { id: "new", label: "New", color: "bg-amber-400" },
  { id: "active", label: "Active", color: "bg-sky-500" },
  { id: "close", label: "Close", color: "bg-emerald-500" },
  { id: "dormant", label: "Dormant", color: "bg-stone-400" },
]

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "Never"
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

export function ContactDrawer({
  person,
  open,
  onOpenChange,
  onPersonUpdated,
  onPersonArchived,
  allLists,
  allTags,
}: {
  person: Person | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onPersonUpdated: (updated: Person) => void
  onPersonArchived: (id: string) => void
  allLists: ListRecord[]
  allTags: TagRecord[]
}) {
  if (!person) return null

  const [status, setStatus] = useState(person.relationshipStatus ?? "new")
  const [activeTab, setActiveTab] = useState<"timeline" | "details">("timeline")

  useEffect(() => {
    setStatus(person.relationshipStatus ?? "new")
  }, [person.id, person.relationshipStatus])

  async function handleStatusChange(newStatus: string) {
    setStatus(newStatus)
    try {
      const res = await fetch(`/api/v1/people/${person?.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relationshipStatus: newStatus }),
      })
      if (!res.ok) throw new Error("Failed to update status")
      onPersonUpdated({ ...person!, relationshipStatus: newStatus })
    } catch (err) {
      console.error(err)
    }
  }

  async function archive() {
    if (!person) return
    if (!window.confirm(`Archive ${person.name}? You can restore archived contacts later.`))
      return
    try {
      const res = await fetch(`/api/v1/people/${person.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to archive contact")
      onPersonArchived(person.id)
      onOpenChange(false)
    } catch (err) {
      console.error(err)
    }
  }

  const substackUrl =
    person.profileUrl ||
    (person.handle ? `https://substack.com/@${person.handle.replace(/^@/, "")}` : null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-xl p-0 flex flex-col h-full bg-stone-50/95 dark:bg-stone-950 backdrop-blur-md overflow-hidden border-l border-stone-200 dark:border-stone-800"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{person.name}</SheetTitle>
          <SheetDescription>Contact profile and conversation timeline for {person.name}</SheetDescription>
        </SheetHeader>

        {/* Header */}
        <div className="p-6 pb-4 border-b border-stone-200/80 bg-white/80 dark:bg-stone-900/80 dark:border-stone-800">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <Avatar className="size-13 border-2 border-white shadow-xs dark:border-stone-800 shrink-0">
                <AvatarFallback className="bg-stone-200 text-stone-700 font-semibold text-sm dark:bg-stone-800 dark:text-stone-300">
                  {initials(person.name)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold tracking-tight truncate text-stone-900 dark:text-stone-100">
                    {person.name}
                  </h2>
                  {substackUrl && (
                    <a
                      href={substackUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open Substack profile"
                      className="text-stone-400 hover:text-[#f15a3a] transition-colors"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  {person.handle ? (
                    <span className="font-mono text-stone-500">@{person.handle}</span>
                  ) : (
                    <span>No handle</span>
                  )}
                  <span>·</span>
                  <span className="capitalize">{person.driftStatus}</span>
                </div>
              </div>
            </div>

            {/* Relationship Status Selector */}
            <div className="shrink-0">
              <Select value={status} onValueChange={handleStatusChange}>
                <SelectTrigger className="h-8.5 rounded-full text-xs font-semibold px-3 bg-white dark:bg-stone-800 border-stone-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id} className="text-xs">
                      <span className={`inline-block size-2 rounded-full mr-2 ${opt.color}`} />
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Engagement Score & Activity Banner */}
          <div className="mt-4 grid grid-cols-5 gap-2 rounded-xl border border-stone-200/80 bg-stone-50 p-2.5 text-center dark:border-stone-800 dark:bg-stone-900">
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500 flex items-center justify-center gap-1">
                <Sparkles className="size-3 text-amber-500" /> Score
              </span>
              <span className="text-lg font-bold text-[#f15a3a] mt-0.5">
                {person.engagementScore}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500">Received</span>
              <span className="text-lg font-bold text-stone-800 dark:text-stone-200 mt-0.5">
                {person.inboundInteractionCount ?? 0}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500">Given</span>
              <span className="text-lg font-bold text-sky-700 dark:text-sky-300 mt-0.5">
                {person.outboundInteractionCount ?? 0}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500">Threads</span>
              <span className="text-lg font-bold text-stone-800 dark:text-stone-200 mt-0.5">
                {person.conversationCount}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-stone-500">Status</span>
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-300 mt-1.5">
                {person.driftStatus}
              </span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 mt-4 pt-1">
            <button
              type="button"
              onClick={() => setActiveTab("timeline")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                activeTab === "timeline"
                  ? "bg-[#191817] text-white shadow-xs"
                  : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
              }`}
            >
              Interaction Timeline
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                activeTab === "details"
                  ? "bg-[#191817] text-white shadow-xs"
                  : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
              }`}
            >
              Notes & Memberships
            </button>
          </div>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "timeline" ? (
            <div className="space-y-6">
              <ProfileBreakdown person={person} />

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                    Activity Stream
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    Latest: {formatDate(person.lastInteractionAt)}
                  </span>
                </div>
                <Timeline personId={person.id} personName={person.name} />
              </div>
            </div>
          ) : (
            <ContactDetailsTab
              person={person}
              allLists={allLists}
              allTags={allTags}
              onPersonUpdated={onPersonUpdated}
            />
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-stone-200/80 bg-white dark:bg-stone-900 dark:border-stone-800 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={archive}
            className="text-stone-500 hover:text-destructive hover:bg-destructive/10 text-xs"
          >
            <Archive className="size-3.5 mr-1.5" /> Archive Contact
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
