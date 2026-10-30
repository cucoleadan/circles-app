import { useCallback, useEffect, useState, type ReactNode } from "react"
import {
  CircleHelp, ExternalLink, Inbox, List, Menu, PenLine, RefreshCw, Send, Settings, Sparkles, TriangleAlert, Users,
} from "lucide-react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { grantedAppOrigin } from "../lib/app-origin"
import { pendingActivityCount } from "../lib/activity-queue"
import type { AppState, DetectedProfile, FlowState } from "../lib/types"
import { circles, CirclesError, message, openInCircles, type Person } from "./api"
import { iconBtn, Logo } from "./ui"
import {
  ConnectCard, countLabel, loadToday, NotesView, PageView, PairForm, PeopleView, SettingsView, TodayView,
  type Target, type TodayData,
} from "./views"

type Tab = "page" | "today" | "people" | "notes" | "settings"
const tabs: Array<{ id: Exclude<Tab, "settings">; label: string }> = [
  { id: "page", label: "This page" },
  { id: "today", label: "Today" },
  { id: "people", label: "People" },
  { id: "notes", label: "Notes" },
]
/** Read by substack.ts; storage.sync is readable from content scripts. */
const IN_PAGE_KEY = "inPageButtons"

export function App() {
  const [origin, setOrigin] = useState<string | null | undefined>(undefined)
  const [pairing, setPairing] = useState(false)
  const [app, setApp] = useState<AppState | null>(null)
  const [appError, setAppError] = useState<CirclesError | null>(null)
  const [flow, setFlow] = useState<FlowState>({ phase: "idle" })
  const [tab, setTab] = useState<Tab>("page")
  const [picked, setPicked] = useState<Target>(null)
  const [tabProfile, setTabProfile] = useState<DetectedProfile | null>(null)
  const [today, setToday] = useState<TodayData | null>(null)
  const [todayError, setTodayError] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [queued, setQueued] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [inPage, setInPage] = useState(true)

  const refresh = useCallback(async () => {
    const paired = await grantedAppOrigin()
    setOrigin(paired)
    setQueued(await pendingActivityCount())
    const status = await message<{ flow?: FlowState }>({ type: "GET_PANEL_STATUS" })
    if (status.flow) setFlow(status.flow)
    if (!paired) return
    try {
      const companion = await circles<{ appState: AppState }>("/api/ext/companion")
      setApp(companion.appState)
      setAppError(null)
    } catch (error) {
      setApp(null)
      setAppError(error instanceof CirclesError ? error : new CirclesError("Could not reach Circles.", 0))
      return
    }
    void loadToday().then((data) => { setToday(data); setTodayError(null) })
      .catch((error) => setTodayError(error instanceof Error ? error.message : "Could not load Today."))
    void circles<{ syncState: { lastSyncedAt: string | null } | null }>("/api/v1/sync")
      .then(({ syncState }) => setLastSyncedAt(syncState?.lastSyncedAt ?? null))
      .catch(() => undefined)
  }, [])

  // Follow the active tab: the person on it becomes "This page".
  const readTab = useCallback(async () => {
    const result = await message<{ profile?: DetectedProfile | null }>({ type: "GET_CURRENT_PROFILE" })
    setTabProfile(result.profile ?? null)
  }, [])

  // Browsing to another profile replaces a person picked from a list.
  useEffect(() => setPicked(null), [tabProfile?.handle])

  useEffect(() => {
    void refresh()
    void readTab()
    void chrome.storage.sync.get(IN_PAGE_KEY).then((stored) => setInPage(stored[IN_PAGE_KEY] !== false))
    const onActivated = () => void readTab()
    const onUpdated = (_id: number, change: { url?: string; status?: string }) => {
      if (change.url || change.status === "complete") void readTab()
    }
    const onMessage = (incoming: { type?: string; flow?: FlowState }) => {
      if (incoming.type !== "FLOW_CHANGED" || !incoming.flow) return
      setFlow(incoming.flow)
      if (incoming.flow.phase === "done") void refresh()
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.runtime.onMessage.addListener(onMessage)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.runtime.onMessage.removeListener(onMessage)
    }
  }, [refresh, readTab])

  const select = (person: Person) => {
    setPicked({ kind: "person", person })
    setTab("page")
  }

  async function syncNow() {
    setSyncing(true)
    try {
      await circles("/api/v1/sync", { method: "POST" })
    } catch {
      // The status line shows the last finished sync either way.
    } finally {
      setTimeout(() => { setSyncing(false); void refresh() }, 1500)
    }
  }

  if (origin === undefined) return <div className="h-full bg-stone-50 dark:bg-stone-950" />

  const paired = origin !== null && !pairing
  const account = app?.connection?.profile.handle ? `@${app.connection.profile.handle}` : app?.connection?.profile.name ?? null
  const pageTarget: Target = picked ?? (tabProfile ? { kind: "handle", handle: tabProfile.handle, name: tabProfile.name } : null)
  const needsReply = today?.queues["needs-reply"] ?? []
  const go = (next: Tab) => { setTab(next); if (next === "page") setPicked(null) }

  return (
    <div className="flex h-full flex-col bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-stone-200/80 bg-white/80 px-3 dark:border-stone-800 dark:bg-stone-900/80">
        <Logo />
        <span className="text-sm font-bold tracking-tight">Circles</span>
        {paired && (
          <div className="ml-auto flex items-center gap-0.5">
            <button type="button" className={iconBtn} title="Sync now" onClick={() => void syncNow()} disabled={syncing}>
              <RefreshCw className={`size-3.5 ${syncing ? "animate-spin text-[#f15a3a]" : ""}`} />
            </button>
            <button type="button" className={iconBtn} title="Open Circles in a new tab" onClick={() => void openInCircles()}>
              <ExternalLink className="size-3.5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger className={iconBtn} title="Menu"><Menu className="size-4" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 text-xs">
                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Action queues</DropdownMenuLabel>
                <MenuEntry icon={<Inbox className="size-3.5 text-[#f15a3a]" />} label="Needs Your Reply" count={today && countLabel(needsReply)} onSelect={() => go("today")} />
                <MenuEntry icon={<Sparkles className="size-3.5 text-[#f15a3a]" />} label="Priority to Engage" count={today && countLabel(today.queues.priority)} onSelect={() => go("today")} />
                <MenuEntry icon={<Send className="size-3.5 text-stone-400" />} label="Ball in Their Court" count={today && countLabel(today.queues["awaiting-response"])} onSelect={() => go("today")} />
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Directory</DropdownMenuLabel>
                <MenuEntry icon={<Users className="size-3.5 text-stone-400" />} label="All Contacts" count={today?.contacts.toLocaleString()} onSelect={() => go("people")} />
                <MenuEntry icon={<List className="size-3.5 text-stone-400" />} label="Lists" count={app ? String(app.lists.length) : null} onSelect={() => go("people")} />
                <MenuEntry icon={<PenLine className="size-3.5 text-stone-400" />} label="Notes" onSelect={() => go("notes")} />
                <DropdownMenuSeparator />
                <MenuEntry icon={<Settings className="size-3.5 text-stone-400" />} label="Settings" onSelect={() => go("settings")} />
                <MenuEntry icon={<CircleHelp className="size-3.5 text-stone-400" />} label="Help" onSelect={() => void openInCircles("/home")} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      {paired && (
        <nav className="grid shrink-0 grid-cols-4 border-b border-stone-200/80 bg-white/60 text-[11px] font-medium dark:border-stone-800 dark:bg-stone-900/60" aria-label="Panel sections">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={`flex h-9 items-center justify-center gap-1.5 border-b-2 ${tab === item.id
                ? "border-[#f15a3a] text-stone-900 dark:text-stone-100"
                : "border-transparent text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"}`}
            >
              {item.label}
              {item.id === "today" && needsReply.length > 0 && (
                <span className="rounded-full bg-[#f15a3a] px-1.5 text-[10px] leading-4 font-semibold text-white">{countLabel(needsReply)}</span>
              )}
            </button>
          ))}
        </nav>
      )}

      <main className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
        {!paired ? (
          <PairForm current={origin} onPaired={() => { setPairing(false); void refresh() }} />
        ) : appError ? (
          <section className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <div className="flex-1 space-y-2">
              <p>
                {appError.status === 401
                  ? <><span className="font-semibold">Log in to Circles</span> to see your contacts, queues and Notes here.</>
                  : <><span className="font-semibold">Circles is not responding.</span> {appError.message}</>}
              </p>
              <div className="flex gap-1.5">
                <button type="button" className="h-7 rounded-md bg-amber-600 px-2.5 text-[11px] font-semibold text-white hover:bg-amber-700" onClick={() => void openInCircles("/login")}>
                  {appError.status === 401 ? "Open Circles to log in" : "Open Circles"}
                </button>
                <button type="button" className="h-7 rounded-md px-2.5 text-[11px] font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40" onClick={() => void refresh()}>Try again</button>
              </div>
            </div>
          </section>
        ) : !app ? (
          <p className="text-stone-500">Loading…</p>
        ) : (
          <>
            {!app.connection && tab !== "settings" && <ConnectCard flow={flow} publicationUrl={null} />}
            {tab === "page" && (
              <PageView
                target={pageTarget}
                lists={app.lists}
                onLookup={(handle) => setPicked({ kind: "handle", handle, name: null })}
                onSelect={select}
                onChanged={() => void refresh()}
              />
            )}
            {tab === "today" && <TodayView data={today} error={todayError} onSelect={select} />}
            {tab === "people" && <PeopleView total={today?.contacts ?? null} onSelect={select} />}
            {tab === "notes" && <NotesView />}
            {tab === "settings" && (
              <>
                <SettingsView
                  origin={origin}
                  account={account}
                  queued={queued}
                  inPage={inPage}
                  onChangeServer={() => setPairing(true)}
                  onInPage={(on) => { setInPage(on); void chrome.storage.sync.set({ [IN_PAGE_KEY]: on }) }}
                />
                {flow.phase !== "idle" && <ConnectCard flow={flow} publicationUrl={app.connection?.publicationUrl ?? null} />}
              </>
            )}
          </>
        )}
      </main>

      {paired && (
        <footer className="flex h-7 shrink-0 items-center gap-1.5 border-t border-stone-200/80 bg-white/60 px-3 text-[10.5px] text-stone-500 dark:border-stone-800 dark:bg-stone-900/60">
          <span className={`size-1.5 shrink-0 rounded-full ${app?.connection ? "bg-emerald-500" : appError ? "bg-rose-500" : "bg-amber-500"}`} />
          <span className="truncate">
            {[
              account ?? (appError ? "Circles unavailable" : "Substack not connected"),
              lastSyncedAt && `synced ${timeSince(lastSyncedAt)}`,
              queued > 0 && `${queued} capture${queued === 1 ? "" : "s"} queued`,
            ].filter(Boolean).join(" · ")}
          </span>
          <span className="ml-auto shrink-0 text-stone-400">v{chrome.runtime.getManifest().version}</span>
        </footer>
      )}
    </div>
  )
}

function timeSince(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

function MenuEntry({ icon, label, count, onSelect }: { icon: ReactNode; label: string; count?: string | null; onSelect: () => void }) {
  return (
    <DropdownMenuItem className="gap-2 text-xs" onSelect={onSelect}>
      {icon}
      <span className="flex-1">{label}</span>
      {count && <span className="text-[11px] text-stone-400 tabular-nums">{count}</span>}
    </DropdownMenuItem>
  )
}
