import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CircleDot,
  LayoutList,
  LoaderCircle,
  PenLine,
  RefreshCw,
  Sheet as SheetIcon,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Toaster } from "@workspace/ui/components/sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import {
  errorMessage,
  errorStatus,
  jsonInit,
  noteTitle,
  notesApi,
  POST_NOW_ABORT_CUTOFF_MS,
  type NoteMention,
  type NoteMode,
  type NotesResponse,
  type ScheduledNote,
} from "../../lib/notes"
import { NoteComposer } from "./note-composer"
import type { NoteHandlers } from "./note-item"
import { NotesCalendar } from "./notes-calendar"
import { NotesQueue } from "./notes-queue"
import { NotesTable } from "./notes-table"

type View = "queue" | "calendar" | "table"
const VIEWS: View[] = ["queue", "calendar", "table"]
const DAY_MS = 24 * 60 * 60 * 1000

function rangeFor(month: Date) {
  const now = Date.now()
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1).getTime()
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime()
  const from = new Date(Math.min(now - 31 * DAY_MS, monthStart - 7 * DAY_MS)).toISOString()
  const to = new Date(Math.max(now + 93 * DAY_MS, monthEnd + 7 * DAY_MS)).toISOString()
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
}

function readView(): View {
  const value = new URLSearchParams(window.location.search).get("view")
  return VIEWS.includes(value as View) ? (value as View) : "queue"
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [active])
  return now
}

export function NotesScheduler({ initial }: { initial: NotesResponse }) {
  const [notes, setNotes] = useState<ScheduledNote[]>(initial.notes)
  const [connection, setConnection] = useState(initial.connection)
  const [view, setView] = useState<View>(readView)
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [refreshing, setRefreshing] = useState(false)
  const [firstSyncDone, setFirstSyncDone] = useState(false)
  const [editing, setEditing] = useState<ScheduledNote | null>(null)
  const [deleting, setDeleting] = useState<ScheduledNote | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [composerSeed, setComposerSeed] = useState<{
    key: number
    seed: { markdown: string; mentions: NoteMention[] } | null
    date: Date | null
  }>({ key: 0, seed: null, date: null })
  const composerRef = useRef<HTMLDivElement>(null)
  const postingIds = useRef(new Set<string>())

  const connectionReady = connection?.status === "active"
  const posting = useMemo(
    () => notes.filter((note) => note.status === "scheduled" && note.postNow),
    [notes],
  )
  const now = useNow(posting.length > 0)

  const applyResponse = useCallback((body: NotesResponse) => {
    setConnection(body.connection)
    setNotes(body.notes)
    // Announce "Post now" Notes that just went live.
    for (const note of body.notes) {
      if (note.status === "published" && postingIds.current.has(note.id)) {
        postingIds.current.delete(note.id)
        toast.success("Your Note is live.", {
          action: note.noteUrl ? { label: "Open", onClick: () => window.open(note.noteUrl!, "_blank") } : undefined,
        })
      }
    }
    for (const note of body.notes) if (note.status === "scheduled" && note.postNow) postingIds.current.add(note.id)
  }, [])

  const refresh = useCallback(
    async (force = false) => {
      setRefreshing(true)
      try {
        const body = await notesApi<NotesResponse>(`/notes/refresh?${force ? "force=1&" : ""}${rangeFor(month)}`, {
          method: "POST",
        })
        applyResponse(body)
      } catch (err) {
        if (force || errorStatus(err) === 401) toast.error(errorMessage(err, "Could not refresh from Substack."))
      } finally {
        setRefreshing(false)
        setFirstSyncDone(true)
      }
    },
    [applyResponse, month],
  )

  // Sync with Substack on open and whenever the tab regains focus (throttled by the API).
  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload the window when the calendar moves outside the loaded range.
  useEffect(() => {
    notesApi<NotesResponse>(`/notes?${rangeFor(month)}`).then(applyResponse).catch(() => {})
  }, [month, applyResponse])

  // Check back shortly after each "Post now" Note's publish time.
  useEffect(() => {
    const timers = posting.map((note) => {
      const due = new Date(note.triggerAt!).getTime() + 4000 - Date.now()
      return setTimeout(() => void refresh(true), Math.max(1000, due))
    })
    return () => timers.forEach(clearTimeout)
  }, [posting, refresh])

  function upsert(note: ScheduledNote) {
    setNotes((prev) => [note, ...prev.filter((item) => item.id !== note.id)])
    if (note.status === "scheduled" && note.postNow) postingIds.current.add(note.id)
  }

  function onSaved(note: ScheduledNote, mode: NoteMode) {
    upsert(note)
    setEditing(null)
    if (mode === "post_now") toast("Posting in 1 minute. You can still abort.")
    else if (mode === "draft") toast.success("Saved as a draft.")
    else toast.success("Scheduled.")
  }

  async function patch(note: ScheduledNote, body: Record<string, unknown>, message: string) {
    setBusyId(note.id)
    try {
      const { note: updated } = await notesApi<{ note: ScheduledNote }>(`/notes/${note.id}`, jsonInit("PATCH", body))
      upsert(updated)
      toast(message)
    } catch (err) {
      toast.error(errorMessage(err, "Could not update the Note."))
    } finally {
      setBusyId(null)
    }
  }

  async function abort(note: ScheduledNote) {
    setBusyId(note.id)
    try {
      const { note: updated } = await notesApi<{ note: ScheduledNote }>(`/notes/${note.id}/abort`, { method: "POST" })
      postingIds.current.delete(note.id)
      upsert(updated)
      toast.success("Aborted. The Note is kept as a draft.")
    } catch (err) {
      toast.error(errorMessage(err, "Could not abort."))
      void refresh(true)
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete() {
    const note = deleting
    if (!note) return
    setBusyId(note.id)
    try {
      await notesApi(`/notes/${note.id}`, { method: "DELETE" })
      setNotes((prev) => prev.filter((item) => item.id !== note.id))
      toast.success("Note deleted from Substack.")
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete the Note."))
    } finally {
      setBusyId(null)
      setDeleting(null)
    }
  }

  function focusComposer(seed: { markdown: string; mentions: NoteMention[] } | null, date: Date | null) {
    setComposerSeed((prev) => ({ key: prev.key + 1, seed, date }))
    requestAnimationFrame(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  const handlers: NoteHandlers = useMemo(
    () => ({
      onEdit: (note) => setEditing(note),
      onPostNow: (note) => void patch(note, { mode: "post_now" }, "Posting in 1 minute. You can still abort."),
      onUnschedule: (note) => void patch(note, { mode: "draft" }, "Moved to drafts."),
      onDuplicate: (note) => {
        focusComposer({ markdown: note.markdown ?? note.bodyText, mentions: note.mentions }, null)
        toast("Copied into the composer.")
      },
      onDelete: (note) => setDeleting(note),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  function changeView(next: string) {
    setView(next as View)
    const url = new URL(window.location.href)
    url.searchParams.set("view", next)
    window.history.replaceState(null, "", url)
  }

  const counts = {
    scheduled: notes.filter((note) => note.status === "scheduled").length,
    drafts: notes.filter((note) => note.status === "draft").length,
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#f7f5f1] text-[#191817] dark:bg-stone-950 dark:text-stone-100">
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/80 backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-center gap-2 text-sm font-bold tracking-tight sm:text-base">
              <span className="flex size-7 items-center justify-center rounded-lg bg-[#f15a3a] text-white shadow-xs">
                <CircleDot className="size-4" />
              </span>
              <span>Circles</span>
            </a>
            <span className="text-stone-300 dark:text-stone-700">/</span>
            <span className="text-sm font-semibold">Notes</span>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden rounded-full text-xs sm:inline-flex">
              <a href="/">
                <ArrowLeft /> Contacts
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full text-xs"
              onClick={() => void refresh(true)}
              disabled={refreshing || !connectionReady}
              title="Refresh from Substack"
            >
              <RefreshCw className={refreshing ? "animate-spin text-[#f15a3a]" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>
      </header>

      {!connectionReady && (
        <div className="flex items-center justify-between gap-3 border-b border-rose-200/90 bg-rose-50 px-4 py-2.5 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200 sm:px-6">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-rose-600" />
            {connection?.status === "expired"
              ? "Your Substack session expired. Reconnect to schedule or change Notes."
              : "Connect your Substack account to schedule Notes."}
          </span>
          <Button asChild size="sm" variant="outline" className="h-7 rounded-full bg-white text-xs dark:bg-stone-900">
            <a href="/?settings=connection">Open settings</a>
          </Button>
        </div>
      )}

      {posting.length > 0 && (
        <div className="border-b border-orange-200 bg-orange-50 dark:border-orange-900/60 dark:bg-orange-950/40">
          <div className="mx-auto max-w-7xl space-y-1.5 px-3 py-2 sm:px-6 lg:px-8">
            {posting.map((note) => {
              const remaining = new Date(note.triggerAt!).getTime() - now
              const seconds = Math.max(0, Math.ceil(remaining / 1000))
              const canAbort = remaining > POST_NOW_ABORT_CUTOFF_MS
              return (
                <div key={note.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-orange-900 dark:text-orange-200">
                    <Zap className="size-3.5 shrink-0 text-[#f15a3a]" />
                    <span className="shrink-0 font-semibold tabular-nums">
                      {remaining > 0 ? `Posting in ${seconds}s` : "Publishing…"}
                    </span>
                    <span className="truncate text-orange-800/80 dark:text-orange-300/80">{noteTitle(note)}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 rounded-full border-orange-300 bg-white text-xs text-orange-900 hover:bg-orange-100 dark:bg-stone-900"
                    disabled={!canAbort || busyId === note.id}
                    onClick={() => void abort(note)}
                  >
                    {busyId === note.id ? <LoaderCircle className="animate-spin" /> : null}
                    Abort
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-3 py-4 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:px-8">
        <div ref={composerRef} className="scroll-mt-20">
          <Card className="rounded-2xl border-stone-200/80 shadow-2xs lg:sticky lg:top-24 dark:border-stone-800">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                <PenLine className="size-4 text-[#f15a3a]" /> New Note
              </CardTitle>
            </CardHeader>
            <CardContent>
              <NoteComposer
                key={composerSeed.key}
                seed={composerSeed.seed}
                initialDate={composerSeed.date}
                connectionReady={connectionReady}
                onSaved={onSaved}
              />
            </CardContent>
          </Card>
        </div>

        <section className="min-w-0 space-y-4">
          <Tabs value={view} onValueChange={changeView}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="queue" className="text-xs">
                  <LayoutList /> Queue
                </TabsTrigger>
                <TabsTrigger value="calendar" className="text-xs">
                  <CalendarDays /> Calendar
                </TabsTrigger>
                <TabsTrigger value="table" className="text-xs">
                  <SheetIcon /> Table
                </TabsTrigger>
              </TabsList>
              <p className="text-xs text-muted-foreground">
                {counts.scheduled} scheduled · {counts.drafts} draft{counts.drafts === 1 ? "" : "s"}
              </p>
            </div>

            {!firstSyncDone && notes.length === 0 ? (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-20 rounded-xl" />
                ))}
              </div>
            ) : (
              <>
                <TabsContent value="queue" className="mt-4">
                  <NotesQueue notes={notes} handlers={handlers} />
                </TabsContent>
                <TabsContent value="calendar" className="mt-4">
                  <NotesCalendar
                    notes={notes}
                    handlers={handlers}
                    month={month}
                    onMonthChange={setMonth}
                    onCreateOn={(day) => focusComposer(null, day)}
                  />
                </TabsContent>
                <TabsContent value="table" className="mt-4">
                  <NotesTable notes={notes} handlers={handlers} />
                </TabsContent>
              </>
            )}
          </Tabs>
        </section>
      </div>

      <Sheet open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto p-5 sm:max-w-lg">
          <SheetHeader className="p-0 pb-3">
            <SheetTitle>{editing?.editable ? "Edit Note" : "Reschedule Note"}</SheetTitle>
            <SheetDescription>
              Changes are saved to Substack{editing?.origin === "substack" ? ", where this Note was created" : ""}.
            </SheetDescription>
          </SheetHeader>
          {editing && (
            <NoteComposer
              key={editing.id}
              note={editing}
              connectionReady={connectionReady}
              onSaved={onSaved}
              onCancel={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Note?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the {deleting?.status === "scheduled" ? "scheduled Note" : "draft"} from Substack. It can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()} disabled={busyId === deleting?.id}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster position="bottom-right" />
    </main>
  )
}
