import { useCallback, useEffect, useState, type SyntheticEvent } from "react"
import {
  AlertCircle,
  AlertTriangle,
  Bookmark,
  Check,
  CheckCircle2,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  HeartHandshake,
  Info,
  Key,
  Plus,
  Puzzle,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Separator } from "@workspace/ui/components/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import type { ListRecord, PriorityQueueSettings, UserSettings } from "../lib/types"

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/circles-companion/bkflpfcomkiclmnllggooedkfcbmflnn?authuser=1&hl=en"

const defaultSettings: UserSettings = {
  priorityQueue: {
    minInbound: 2,
    maxOutbound: 1,
    minRestacks: 1,
    driftingMinDays: 21,
    driftingMaxDays: 90,
    vipScoreThreshold: 12,
  },
}

export interface SubstackConnectionInfo {
  id: string
  publicationUrl: string | null
  profileId: string | null
  profileName: string | null
  profileHandle: string | null
  status: "active" | "expired" | "revoked"
  lastVerifiedAt: string | null
  createdAt: string
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab = "connection",
  onSaved,
  onConnectionUpdated,
  lists = [],
  onCreateList,
  onUpdateList,
  onDeleteList,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: "connection" | "queue" | "extension" | "lists"
  onSaved?: () => void
  onConnectionUpdated?: () => void
  lists?: ListRecord[]
  onCreateList?: (name: string, description?: string | null) => Promise<ListRecord | void>
  onUpdateList?: (listId: string, name: string, description?: string | null) => Promise<ListRecord | void>
  onDeleteList?: (listId: string) => Promise<boolean>
}) {
  const [activeTab, setActiveTab] = useState<"connection" | "queue" | "extension" | "lists">(initialTab)
  const [settings, setSettings] = useState<UserSettings>(defaultSettings)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)

  // Substack Connection State
  const [connection, setConnection] = useState<SubstackConnectionInfo | null>(null)
  const [connectionLoading, setConnectionLoading] = useState(false)
  const [connectionBusy, setConnectionBusy] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [connectionSuccess, setConnectionSuccess] = useState<string | null>(null)
  const [cookieInput, setCookieInput] = useState("")
  const [publicationUrlInput, setPublicationUrlInput] = useState("")
  const [showToken, setShowToken] = useState(false)

  // List Management State
  const [newListName, setNewListName] = useState("")
  const [newListDesc, setNewListDesc] = useState("")
  const [creatingList, setCreatingList] = useState(false)
  const [createListError, setCreateListError] = useState<string | null>(null)

  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [editingDesc, setEditingDesc] = useState("")
  const [updatingList, setUpdatingList] = useState(false)
  const [updateListError, setUpdateListError] = useState<string | null>(null)

  const [deletingList, setDeletingList] = useState<ListRecord | null>(null)
  const [isDeletingList, setIsDeletingList] = useState(false)
  const [listSearch, setListSearch] = useState("")

  const fetchConnection = useCallback(async () => {
    setConnectionLoading(true)
    try {
      const res = await fetch("/api/v1/connection")
      if (res.ok) {
        const data = await res.json()
        setConnection(data.connection ?? null)
        if (data.connection?.publicationUrl) {
          setPublicationUrlInput(data.connection.publicationUrl)
        }
      }
    } catch (err) {
      console.error("Error loading connection:", err)
    } finally {
      setConnectionLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setActiveTab(initialTab)
    setConnectionError(null)
    setConnectionSuccess(null)
    setCookieInput("")

    setLoading(true)
    fetch("/api/v1/settings")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load settings")
        return res.json()
      })
      .then((data) => {
        if (data.settings) {
          setSettings(data.settings)
        }
      })
      .catch((err) => console.error("Error loading settings:", err))
      .finally(() => setLoading(false))

    void fetchConnection()
  }, [open, initialTab, fetchConnection])

  function updateQueueParam<K extends keyof PriorityQueueSettings>(
    key: K,
    value: PriorityQueueSettings[K]
  ) {
    setSettings((prev) => ({
      ...prev,
      priorityQueue: {
        ...prev.priorityQueue,
        [key]: value,
      },
    }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/v1/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error("Failed to save settings")
      setSavedNotice(true)
      setTimeout(() => setSavedNotice(false), 2500)
      if (onSaved) onSaved()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setSettings(defaultSettings)
  }

  async function handleSaveConnection() {
    if (!cookieInput.trim()) return
    setConnectionBusy(true)
    setConnectionError(null)
    setConnectionSuccess(null)
    try {
      const res = await fetch("/api/v1/connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionToken: cookieInput.trim(),
          publicationUrl: publicationUrlInput.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to save connection")
      }
      setConnection(data.connection)
      setCookieInput("")
      setConnectionSuccess(
        data.connection?.profileName
          ? `Connected as ${data.connection.profileName} (@${data.connection.profileHandle ?? ""})`
          : "Substack connection updated successfully!"
      )
      if (onConnectionUpdated) onConnectionUpdated()
    } catch (err: any) {
      setConnectionError(err?.message || "Failed to update Substack connection")
    } finally {
      setConnectionBusy(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm("Are you sure you want to disconnect this Substack account?")) return
    setConnectionBusy(true)
    setConnectionError(null)
    try {
      const res = await fetch("/api/v1/connection", { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to disconnect")
      setConnection(null)
      setConnectionSuccess("Disconnected Substack connection.")
      if (onConnectionUpdated) onConnectionUpdated()
    } catch (err: any) {
      setConnectionError(err?.message || "Failed to disconnect")
    } finally {
      setConnectionBusy(false)
    }
  }

  async function handleCreateListSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = newListName.trim()
    if (!trimmed || creatingList || !onCreateList) return
    setCreatingList(true)
    setCreateListError(null)
    try {
      await onCreateList(trimmed, newListDesc.trim() || null)
      setNewListName("")
      setNewListDesc("")
    } catch (err: any) {
      setCreateListError(err?.message || "Failed to create list")
    } finally {
      setCreatingList(false)
    }
  }

  function startEditingList(list: ListRecord) {
    setEditingListId(list.id)
    setEditingName(list.name)
    setEditingDesc(list.description || "")
    setUpdateListError(null)
  }

  function cancelEditingList() {
    setEditingListId(null)
    setEditingName("")
    setEditingDesc("")
    setUpdateListError(null)
  }

  async function handleUpdateListSubmit(listId: string) {
    const trimmed = editingName.trim()
    if (!trimmed || updatingList || !onUpdateList) return
    setUpdatingList(true)
    setUpdateListError(null)
    try {
      await onUpdateList(listId, trimmed, editingDesc.trim() || null)
      setEditingListId(null)
    } catch (err: any) {
      setUpdateListError(err?.message || "Failed to update list")
    } finally {
      setUpdatingList(false)
    }
  }

  async function handleDeleteListConfirm() {
    if (!deletingList || isDeletingList || !onDeleteList) return
    setIsDeletingList(true)
    try {
      const ok = await onDeleteList(deletingList.id)
      if (ok) {
        setDeletingList(null)
      }
    } finally {
      setIsDeletingList(false)
    }
  }

  const filteredLists = lists.filter((l) => {
    if (!listSearch.trim()) return true
    const term = listSearch.toLowerCase()
    return (
      l.name.toLowerCase().includes(term) ||
      (l.description && l.description.toLowerCase().includes(term))
    )
  })

  const q = settings.priorityQueue

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col h-full bg-stone-50/95 dark:bg-stone-950 backdrop-blur-md overflow-hidden border-l border-stone-200 dark:border-stone-800">
        <SheetHeader className="p-6 pb-3 border-b border-stone-200/80 bg-white/80 dark:bg-stone-900/80 dark:border-stone-800">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300">
              <Settings className="size-4 text-[#f15a3a]" />
            </span>
            <div>
              <SheetTitle className="text-lg font-bold text-stone-900 dark:text-stone-100">
                Workspace Settings
              </SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground mt-0.5">
                Manage your Substack session credentials, lists, and smart engagement algorithms.
              </SheetDescription>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="grid grid-cols-4 gap-1 p-1 bg-stone-100/90 dark:bg-stone-800/80 rounded-xl mt-3 text-xs border border-stone-200/60 dark:border-stone-800">
            <button
              type="button"
              onClick={() => setActiveTab("connection")}
              className={`py-1.5 px-1.5 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-all text-xs select-none min-w-0 ${
                activeTab === "connection"
                  ? "bg-white text-stone-900 shadow-2xs font-bold dark:bg-stone-900 dark:text-stone-100"
                  : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              }`}
              title="Substack Connection"
            >
              <Key className="size-3.5 shrink-0 text-[#f15a3a]" />
              <span className="truncate">Connection</span>
              {connection?.status === "expired" && (
                <span className="size-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("queue")}
              className={`py-1.5 px-1.5 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-all text-xs select-none min-w-0 ${
                activeTab === "queue"
                  ? "bg-white text-stone-900 shadow-2xs font-bold dark:bg-stone-900 dark:text-stone-100"
                  : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              }`}
              title="Smart Queue Rules"
            >
              <Sparkles className="size-3.5 shrink-0 text-[#f15a3a]" />
              <span className="truncate">Queue</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("lists")}
              className={`py-1.5 px-1.5 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-all text-xs select-none min-w-0 ${
                activeTab === "lists"
                  ? "bg-white text-stone-900 shadow-2xs font-bold dark:bg-stone-900 dark:text-stone-100"
                  : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              }`}
              title="Manage Contact Lists"
            >
              <Bookmark className="size-3.5 shrink-0 text-[#f15a3a]" />
              <span className="truncate">Lists</span>
              <span className="rounded-full bg-stone-200/80 dark:bg-stone-700 px-1.5 py-0.2 text-[9px] font-bold shrink-0">
                {lists.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("extension")}
              className={`py-1.5 px-1.5 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-all text-xs select-none min-w-0 ${
                activeTab === "extension"
                  ? "bg-white text-stone-900 shadow-2xs font-bold dark:bg-stone-900 dark:text-stone-100"
                  : "text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              }`}
              title="Chrome Companion Extension"
            >
              <Puzzle className="size-3.5 shrink-0 text-[#f15a3a]" />
              <span className="truncate">Extension</span>
            </button>
          </div>
        </SheetHeader>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {activeTab === "connection" && (
            <div className="space-y-5">
              {/* Current Status Card */}
              <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-2xs dark:border-stone-800 dark:bg-stone-900 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="size-4 text-[#f15a3a]" />
                    <h3 className="font-bold text-stone-900 dark:text-stone-100 text-sm">
                      Current Substack Connection
                    </h3>
                  </div>
                  {connectionLoading ? (
                    <span className="text-[10px] text-muted-foreground">Checking…</span>
                  ) : !connection ? (
                    <span className="rounded-full bg-stone-100 text-stone-600 border border-stone-200 px-2 py-0.5 text-[10px] font-semibold dark:bg-stone-800 dark:text-stone-400">
                      Not Connected
                    </span>
                  ) : connection.status === "active" ? (
                    <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-semibold dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 flex items-center gap-1">
                      <CheckCircle2 className="size-3" /> Active &amp; Connected
                    </span>
                  ) : (
                    <span className="rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-0.5 text-[10px] font-semibold dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 flex items-center gap-1 animate-pulse">
                      <AlertTriangle className="size-3" /> Session Expired
                    </span>
                  )}
                </div>

                {connection ? (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-[11.5px] py-1 border-b border-stone-100 dark:border-stone-800/60">
                      <span className="text-muted-foreground">Profile</span>
                      <span className="font-medium text-stone-900 dark:text-stone-100">
                        {connection.profileName || "Unknown"}
                        {connection.profileHandle && ` (@${connection.profileHandle})`}
                      </span>
                    </div>
                    {connection.publicationUrl && (
                      <div className="flex items-center justify-between text-[11.5px] py-1 border-b border-stone-100 dark:border-stone-800/60">
                        <span className="text-muted-foreground">Publication</span>
                        <a
                          href={connection.publicationUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-[#f15a3a] hover:underline flex items-center gap-1 truncate max-w-[220px]"
                        >
                          {connection.publicationUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[11.5px] py-1">
                      <span className="text-muted-foreground">Last Verified</span>
                      <span className="text-stone-600 dark:text-stone-400">
                        {connection.lastVerifiedAt
                          ? new Date(connection.lastVerifiedAt).toLocaleString()
                          : "Never"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-[11.5px]">
                    No active Substack connection linked. Paste your session cookie below to enable background sync and activity capture.
                  </p>
                )}

                {connection?.status === "expired" && (
                  <div className="rounded-xl bg-rose-50/80 border border-rose-200/80 p-3 text-rose-800 dark:bg-rose-950/30 dark:border-rose-900/40 dark:text-rose-300 text-[11.5px] space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertCircle className="size-3.5" /> Substack Session Expired (401)
                    </div>
                    <p className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-400">
                      Substack returned 401 Unauthorized for your session. Scheduled sync and backfills are paused until you paste your latest <code className="bg-rose-100 dark:bg-rose-900/50 px-1 py-0.5 rounded font-mono text-[10px]">substack.sid</code> cookie below.
                    </p>
                  </div>
                )}
              </div>

              {/* Update / Connect Form Card */}
              <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-2xs dark:border-stone-800 dark:bg-stone-900 space-y-4">
                <div>
                  <h4 className="font-bold text-stone-900 dark:text-stone-100 text-sm">
                    {connection ? "Update Session Cookie" : "Connect Substack Account"}
                  </h4>
                  <p className="text-muted-foreground text-[11px] mt-0.5">
                    Circles communicates securely with Substack's private API using your account session cookie.
                  </p>
                </div>

                {/* Instructions Box */}
                <div className="rounded-xl bg-stone-50 border border-stone-200/70 dark:bg-stone-950 dark:border-stone-800/80 p-3 text-[11px] text-stone-600 dark:text-stone-400 space-y-1.5">
                  <div className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                    <Info className="size-3.5 text-[#f15a3a]" /> How to find your session cookie:
                  </div>
                  <ol className="list-decimal list-inside space-y-1 pl-1 text-[10.5px]">
                    <li>Open and log in to <strong className="text-stone-800 dark:text-stone-200">substack.com</strong> in your browser.</li>
                    <li>Press <kbd className="px-1 py-0.5 bg-stone-200 dark:bg-stone-800 rounded text-[9.5px]">F12</kbd> (or right-click → <em>Inspect</em>) to open Developer Tools.</li>
                    <li>Go to <strong className="text-stone-800 dark:text-stone-200">Application</strong> (or <strong className="text-stone-800 dark:text-stone-200">Storage</strong>) → <strong className="text-stone-800 dark:text-stone-200">Cookies</strong> → <code className="text-[10px]">https://substack.com</code>.</li>
                    <li>Find <strong className="text-stone-800 dark:text-stone-200">substack.sid</strong> and copy its <strong>Value</strong>.</li>
                  </ol>
                </div>

                {connectionError && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300 text-[11px] flex items-start gap-2">
                    <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                    <span>{connectionError}</span>
                  </div>
                )}

                {connectionSuccess && (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300 text-[11px] flex items-center gap-2">
                    <Check className="size-3.5 shrink-0" />
                    <span>{connectionSuccess}</span>
                  </div>
                )}

                <div className="space-y-3 pt-1">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-medium text-stone-700 dark:text-stone-300">
                        Session Cookie (<code className="text-[10px]">substack.sid</code>)
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="text-[10.5px] text-muted-foreground hover:text-stone-800 dark:hover:text-stone-200 flex items-center gap-1"
                      >
                        {showToken ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                        {showToken ? "Hide" : "Show"}
                      </button>
                    </div>
                    <Input
                      type={showToken ? "text" : "password"}
                      value={cookieInput}
                      onChange={(e) => setCookieInput(e.target.value)}
                      placeholder="Paste your substack.sid cookie value…"
                      className="h-8.5 text-xs bg-stone-50 dark:bg-stone-950 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-stone-700 dark:text-stone-300">
                      Publication URL <span className="text-muted-foreground font-normal">(Optional)</span>
                    </label>
                    <Input
                      type="url"
                      value={publicationUrlInput}
                      onChange={(e) => setPublicationUrlInput(e.target.value)}
                      placeholder="https://yourpublication.substack.com"
                      className="h-8.5 text-xs bg-stone-50 dark:bg-stone-950"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    {connection ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleDisconnect}
                        disabled={connectionBusy}
                        className="text-xs text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-900/50 dark:hover:bg-rose-950/30 h-8 rounded-full"
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <div />
                    )}

                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveConnection}
                      disabled={connectionBusy || !cookieInput.trim()}
                      className="text-xs font-semibold bg-[#f15a3a] hover:bg-[#d94a2b] text-white px-4 h-8.5 rounded-full shadow-xs transition-all"
                    >
                      {connectionBusy ? (
                        <>
                          <RefreshCw className="size-3 animate-spin mr-1.5" />
                          Verifying with Substack…
                        </>
                      ) : (
                        "Verify & Save Cookie"
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Companion Extension Quick Card */}
              <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-9 rounded-xl bg-gradient-to-br from-[#f15a3a] to-[#ff7e5f] text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Puzzle className="size-4.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-stone-900 dark:text-stone-100 text-xs truncate flex items-center gap-1.5">
                      Circles Companion Extension
                      <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/80 px-1.5 py-0.2 text-[9px] font-bold">
                        Web Store
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      Capture outbound likes, restacks, and comments while browsing Substack.
                    </p>
                  </div>
                </div>
                <a
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-[#f15a3a] hover:bg-[#d94828] text-white px-3.5 py-1.5 text-xs font-semibold shadow-xs transition-colors"
                >
                  Install
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </div>
          )}

          {activeTab === "queue" && (
            <>
              {loading ? (
                <div className="py-12 text-center text-stone-400">
                  <RefreshCw className="size-5 animate-spin mx-auto mb-2 text-[#f15a3a]" />
                  <p>Loading your preferences…</p>
                </div>
              ) : (
                <>
                  {/* Priority to Engage Section */}
                  <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-2xs dark:border-stone-800 dark:bg-stone-900 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-[#f15a3a]" />
                        <h3 className="font-bold text-stone-900 dark:text-stone-100 text-sm">
                          "Priority to Engage" Criteria
                        </h3>
                      </div>
                      <span className="rounded-full bg-orange-50 text-[#f15a3a] border border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 px-2 py-0.5 text-[10px] font-semibold">
                        Smart Queue
                      </span>
                    </div>
                    <p className="text-muted-foreground leading-relaxed text-[11.5px]">
                      Controls who automatically surfaces in your <strong>Priority to Engage</strong> queue. Anyone matching at least one of these criteria will be prioritized.
                    </p>

                    <Separator />

                    {/* Rule 1: Return the Love */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <HeartHandshake className="size-3.5 text-emerald-600" />
                        <span className="font-semibold text-stone-800 dark:text-stone-200">
                          1. Unreciprocated Supporters ("Return the Love")
                        </span>
                      </div>
                      <p className="text-muted-foreground text-[11px]">
                        People who support your notes/posts, but haven't received reciprocal engagement back from you.
                      </p>
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-stone-600 dark:text-stone-400">
                            Min Inbound Touches
                          </label>
                          <Input
                            type="number"
                            min={1}
                            max={50}
                            value={q.minInbound}
                            onChange={(e) => updateQueueParam("minInbound", Math.max(1, Number(e.target.value)))}
                            className="h-8 text-xs bg-stone-50 dark:bg-stone-950"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-stone-600 dark:text-stone-400">
                            Max Outbound Touches
                          </label>
                          <Input
                            type="number"
                            min={0}
                            max={10}
                            value={q.maxOutbound}
                            onChange={(e) => updateQueueParam("maxOutbound", Math.max(0, Number(e.target.value)))}
                            className="h-8 text-xs bg-stone-50 dark:bg-stone-950"
                          />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* Rule 2: Super Amplifiers */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Repeat className="size-3.5 text-violet-600" />
                        <span className="font-semibold text-stone-800 dark:text-stone-200">
                          2. Substack Amplifiers (Restackers)
                        </span>
                      </div>
                      <p className="text-muted-foreground text-[11px]">
                        People who restacked your content, where you haven't engaged back with their notes since.
                      </p>
                      <div className="max-w-xs pt-1 space-y-1">
                        <label className="text-[11px] font-medium text-stone-600 dark:text-stone-400">
                          Min Restacks Required
                        </label>
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          value={q.minRestacks}
                          onChange={(e) => updateQueueParam("minRestacks", Math.max(1, Number(e.target.value)))}
                          className="h-8 text-xs bg-stone-50 dark:bg-stone-950"
                        />
                      </div>
                    </div>

                    <Separator />

                    {/* Rule 3: Drifting VIPs */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Flame className="size-3.5 text-amber-500" />
                        <span className="font-semibold text-stone-800 dark:text-stone-200">
                          3. Drifting Supporters (Inner Circle Cooling Off)
                        </span>
                      </div>
                      <p className="text-muted-foreground text-[11px]">
                        High-engagement supporters who haven't had an interaction in a while and need reconnection.
                      </p>
                      <div className="grid grid-cols-3 gap-2.5 pt-1">
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-stone-600 dark:text-stone-400">
                            Min VIP Score
                          </label>
                          <Input
                            type="number"
                            min={5}
                            max={100}
                            value={q.vipScoreThreshold}
                            onChange={(e) => updateQueueParam("vipScoreThreshold", Math.max(1, Number(e.target.value)))}
                            className="h-8 text-xs bg-stone-50 dark:bg-stone-950"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-stone-600 dark:text-stone-400">
                            Drift Start (Days)
                          </label>
                          <Input
                            type="number"
                            min={7}
                            max={180}
                            value={q.driftingMinDays}
                            onChange={(e) => updateQueueParam("driftingMinDays", Math.max(7, Number(e.target.value)))}
                            className="h-8 text-xs bg-stone-50 dark:bg-stone-950"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-stone-600 dark:text-stone-400">
                            Drift End (Days)
                          </label>
                          <Input
                            type="number"
                            min={14}
                            max={365}
                            value={q.driftingMaxDays}
                            onChange={(e) => updateQueueParam("driftingMaxDays", Math.max(14, Number(e.target.value)))}
                            className="h-8 text-xs bg-stone-50 dark:bg-stone-950"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {activeTab === "extension" && (
            <div className="space-y-5">
              {/* Extension Hero & Install Card */}
              <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-2xs dark:border-stone-800 dark:bg-stone-900 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-xl bg-gradient-to-br from-[#f15a3a] to-[#ff7e5f] text-white flex items-center justify-center shadow-xs">
                      <Puzzle className="size-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-stone-900 dark:text-stone-100 text-sm flex items-center gap-2">
                        Circles Companion Extension
                        <span className="rounded-full bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300 px-2 py-0.5 text-[10px] font-semibold">
                          v0.2.5
                        </span>
                        <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/80 px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1">
                          <Check className="size-2.5" /> Web Store
                        </span>
                      </h3>
                      <p className="text-[11.5px] text-muted-foreground mt-0.5">
                        Chrome Manifest V3 · Seamless Substack sync &amp; outbound touch capture
                      </p>
                    </div>
                  </div>
                </div>

                <p className="text-stone-600 dark:text-stone-300 text-xs leading-relaxed">
                  Circles Companion is officially published on the Chrome Web Store. Install it directly with 1 click to automatically sync your session and capture outbound likes, restacks, and comments into Circles.
                </p>

                <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                  <a
                    href={CHROME_STORE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#f15a3a] hover:bg-[#d94828] text-white px-5 py-2.5 text-xs font-semibold shadow-xs transition-colors"
                  >
                    <ExternalLink className="size-4" />
                    Install from Chrome Web Store
                  </a>
                  <a
                    href="/downloads/circles-companion-0.2.5.zip"
                    download="circles-companion-0.2.5.zip"
                    className="inline-flex items-center justify-center gap-1.5 rounded-full border border-stone-200 bg-stone-50/80 hover:bg-stone-100 text-stone-700 dark:border-stone-800 dark:bg-stone-800/80 dark:text-stone-300 dark:hover:bg-stone-800 px-3.5 py-2 text-xs font-medium transition-colors"
                  >
                    <Download className="size-3.5" />
                    Download ZIP (Developer Mode)
                  </a>
                </div>
              </div>

              {/* 1-Click Install Guide */}
              <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-2xs dark:border-stone-800 dark:bg-stone-900 space-y-3.5">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-stone-900 dark:text-stone-100 text-xs uppercase tracking-wider text-stone-500">
                    Quick 1-Click Installation
                  </h4>
                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> Recommended
                  </span>
                </div>

                <ol className="space-y-3 pt-1 text-xs">
                  <li className="flex items-start gap-2.5">
                    <span className="size-5 rounded-full bg-[#f15a3a]/10 text-[#f15a3a] font-bold flex items-center justify-center shrink-0 text-[11px]">
                      1
                    </span>
                    <div className="space-y-0.5">
                      <p className="font-semibold text-stone-800 dark:text-stone-200">
                        Open the Chrome Web Store listing
                      </p>
                      <p className="text-muted-foreground text-[11.5px]">
                        Click the{" "}
                        <a
                          href={CHROME_STORE_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-[#f15a3a] hover:underline inline-flex items-center gap-0.5"
                        >
                          Install from Chrome Web Store
                          <ExternalLink className="size-2.5" />
                        </a>{" "}
                        button above to go to the official listing page.
                      </p>
                    </div>
                  </li>

                  <li className="flex items-start gap-2.5">
                    <span className="size-5 rounded-full bg-[#f15a3a]/10 text-[#f15a3a] font-bold flex items-center justify-center shrink-0 text-[11px]">
                      2
                    </span>
                    <div className="space-y-0.5">
                      <p className="font-semibold text-stone-800 dark:text-stone-200">
                        Click "Add to Chrome"
                      </p>
                      <p className="text-muted-foreground text-[11.5px]">
                        On the Google store page, click <strong>Add to Chrome</strong> (or your browser's install button) and confirm the extension permissions.
                      </p>
                    </div>
                  </li>

                  <li className="flex items-start gap-2.5">
                    <span className="size-5 rounded-full bg-[#f15a3a]/10 text-[#f15a3a] font-bold flex items-center justify-center shrink-0 text-[11px]">
                      3
                    </span>
                    <div className="space-y-0.5">
                      <p className="font-semibold text-stone-800 dark:text-stone-200">
                        Browse Substack &amp; Enjoy Automatic Capture
                      </p>
                      <p className="text-muted-foreground text-[11.5px]">
                        Open Substack in your browser. Circles Companion automatically detects your session and captures your outbound likes, restacks, and replies directly into Circles!
                      </p>
                    </div>
                  </li>
                </ol>
              </div>

              {/* Developer Mode Alternative (Collapsible) */}
              <details className="group rounded-2xl border border-stone-200/80 bg-white p-5 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
                <summary className="font-bold text-stone-900 dark:text-stone-100 text-xs uppercase tracking-wider text-stone-500 cursor-pointer flex items-center justify-between list-none select-none">
                  <span>Alternative: Manual Developer Mode Install</span>
                  <span className="text-[11px] text-stone-400 font-normal group-open:rotate-180 transition-transform">▼</span>
                </summary>

                <div className="pt-4 space-y-3.5">
                  <p className="text-stone-600 dark:text-stone-300 text-xs leading-relaxed">
                    If you prefer installing manually from the downloaded ZIP archive instead of the Chrome Web Store:
                  </p>

                  <ol className="space-y-3 pt-1 text-xs">
                    <li className="flex items-start gap-2.5">
                      <span className="size-5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-bold flex items-center justify-center shrink-0 text-[11px]">
                        1
                      </span>
                      <div className="space-y-0.5">
                        <p className="font-semibold text-stone-800 dark:text-stone-200">
                          Download &amp; Unzip
                        </p>
                        <p className="text-muted-foreground text-[11.5px]">
                          Click the "Download ZIP" button and extract the ZIP archive to a folder on your computer.
                        </p>
                      </div>
                    </li>

                    <li className="flex items-start gap-2.5">
                      <span className="size-5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-bold flex items-center justify-center shrink-0 text-[11px]">
                        2
                      </span>
                      <div className="space-y-0.5">
                        <p className="font-semibold text-stone-800 dark:text-stone-200">
                          Open Chrome Extension Manager
                        </p>
                        <p className="text-muted-foreground text-[11.5px]">
                          In Chrome, Brave, or Edge, navigate to{" "}
                          <code className="bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded font-mono text-[11px]">
                            chrome://extensions
                          </code>
                          .
                        </p>
                      </div>
                    </li>

                    <li className="flex items-start gap-2.5">
                      <span className="size-5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-bold flex items-center justify-center shrink-0 text-[11px]">
                        3
                      </span>
                      <div className="space-y-0.5">
                        <p className="font-semibold text-stone-800 dark:text-stone-200">
                          Enable Developer Mode
                        </p>
                        <p className="text-muted-foreground text-[11.5px]">
                          In the top right corner of the Extensions page, switch the <strong>Developer mode</strong> toggle to ON.
                        </p>
                      </div>
                    </li>

                    <li className="flex items-start gap-2.5">
                      <span className="size-5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-bold flex items-center justify-center shrink-0 text-[11px]">
                        4
                      </span>
                      <div className="space-y-0.5">
                        <p className="font-semibold text-stone-800 dark:text-stone-200">
                          Click "Load unpacked"
                        </p>
                        <p className="text-muted-foreground text-[11.5px]">
                          Click the <strong>Load unpacked</strong> button in the top-left toolbar, and select the unzipped extension folder (containing <code className="font-mono">manifest.json</code>).
                        </p>
                      </div>
                    </li>
                  </ol>
                </div>
              </details>

              {/* Web Store Active Info Card */}
              <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20 text-stone-600 dark:text-stone-400 text-xs">
                <p className="flex items-center gap-1.5 font-semibold text-emerald-900 dark:text-emerald-300">
                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" /> Official Chrome Web Store Listing
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-emerald-800/90 dark:text-emerald-300/80">
                  Installing directly from the Chrome Web Store provides 1-click installation and automatic background updates.
                </p>
                <div className="mt-2.5">
                  <a
                    href={CHROME_STORE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#f15a3a] hover:underline"
                  >
                    Open listing on Chrome Web Store
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {activeTab === "lists" && (
            <div className="space-y-6">
              {/* Info banner */}
              <div className="rounded-xl border border-stone-200/80 bg-white p-4 shadow-2xs dark:border-stone-800 dark:bg-stone-900 text-stone-600 dark:text-stone-400 text-xs space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-stone-900 dark:text-stone-100">
                  <Bookmark className="size-4 text-[#f15a3a]" />
                  <span>Contact Lists &amp; Cohorts</span>
                </div>
                <p className="text-[11.5px] leading-relaxed">
                  Lists help you organize your contacts into meaningful groups (such as Mentors, VIPs, or Ignored). Deleting a list unlinks contacts, but <strong>never deletes contacts or their interactions</strong>.
                </p>
              </div>

              {/* Create New List Card */}
              <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-2xs dark:border-stone-800 dark:bg-stone-900 space-y-3.5">
                <div className="flex items-center gap-2">
                  <Plus className="size-4 text-[#f15a3a]" />
                  <h3 className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-sm">
                    Create New List
                  </h3>
                </div>

                <form onSubmit={handleCreateListSubmit} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
                      List Name <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      value={newListName}
                      onChange={(e) => {
                        setNewListName(e.target.value)
                        setCreateListError(null)
                      }}
                      placeholder="e.g. VIPs, Collaborators, Advisers…"
                      className="text-xs h-8.5 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-400 mb-1">
                      Description <span className="text-stone-400 font-normal">(optional)</span>
                    </label>
                    <Input
                      value={newListDesc}
                      onChange={(e) => setNewListDesc(e.target.value)}
                      placeholder="e.g. Key relationships to check in with monthly…"
                      className="text-xs h-8.5 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800"
                    />
                  </div>

                  {createListError && (
                    <div className="flex items-center gap-1.5 text-[11px] text-rose-600 font-medium">
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span>{createListError}</span>
                    </div>
                  )}

                  <div className="flex justify-end pt-1">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={creatingList || !newListName.trim()}
                      className="text-xs font-semibold bg-[#f15a3a] hover:bg-[#d94827] text-white h-8 px-4 rounded-full shadow-xs"
                    >
                      <Plus className="size-3.5 mr-1" />
                      {creatingList ? "Creating…" : "Create List"}
                    </Button>
                  </div>
                </form>
              </div>

              {/* Lists Inventory */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-sm">
                      Your Lists
                    </h3>
                    <span className="rounded-full bg-stone-200/80 dark:bg-stone-800 px-2 py-0.5 text-[10px] font-semibold text-stone-700 dark:text-stone-300">
                      {lists.length}
                    </span>
                  </div>

                  {lists.length > 2 && (
                    <div className="relative w-44">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-stone-400" />
                      <Input
                        value={listSearch}
                        onChange={(e) => setListSearch(e.target.value)}
                        placeholder="Search lists…"
                        className="pl-7 h-7 text-[11px] bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800 rounded-lg"
                      />
                    </div>
                  )}
                </div>

                {filteredLists.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-stone-200 dark:border-stone-800 p-6 text-center text-stone-400">
                    <Bookmark className="size-6 mx-auto mb-2 text-stone-300 dark:text-stone-700" />
                    <p className="text-xs font-medium">
                      {lists.length === 0 ? "No lists created yet" : "No lists matching your search"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {lists.length === 0 ? "Create your first list above to organize contacts." : "Try a different search term."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredLists.map((l) => {
                      const isIgnored = l.name.toLowerCase() === "ignored"
                      const isEditing = editingListId === l.id

                      if (isEditing) {
                        return (
                          <div
                            key={l.id}
                            className="rounded-xl border border-[#f15a3a]/40 bg-white p-3.5 shadow-2xs dark:border-[#f15a3a]/40 dark:bg-stone-900 space-y-3"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                                <Edit2 className="size-3.5 text-[#f15a3a]" /> Edit List
                              </span>
                              <button
                                type="button"
                                onClick={cancelEditingList}
                                className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>

                            <div className="space-y-2">
                              <div>
                                <label className="block text-[10.5px] font-semibold text-stone-500 mb-0.5">
                                  List Name
                                </label>
                                <Input
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  className="text-xs h-7.5 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800"
                                />
                              </div>
                              <div>
                                <label className="block text-[10.5px] font-semibold text-stone-500 mb-0.5">
                                  Description
                                </label>
                                <Input
                                  value={editingDesc}
                                  onChange={(e) => setEditingDesc(e.target.value)}
                                  className="text-xs h-7.5 bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800"
                                />
                              </div>
                            </div>

                            {updateListError && (
                              <p className="text-[11px] text-rose-500 font-medium">
                                {updateListError}
                              </p>
                            )}

                            <div className="flex items-center justify-end gap-2 pt-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={updatingList}
                                onClick={cancelEditingList}
                                className="h-7 text-xs px-2.5 rounded-md"
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                disabled={updatingList || !editingName.trim()}
                                onClick={() => handleUpdateListSubmit(l.id)}
                                className="h-7 text-xs px-3 bg-[#191817] hover:bg-[#302e2c] text-white rounded-md font-semibold"
                              >
                                {updatingList ? "Saving…" : "Save Changes"}
                              </Button>
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div
                          key={l.id}
                          className="group rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-2xs hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700 transition-all flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {isIgnored ? (
                                <EyeOff className="size-3.5 text-rose-500 shrink-0" />
                              ) : (
                                <Bookmark className="size-3.5 text-[#f15a3a] shrink-0" />
                              )}
                              <span className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-[13px]">
                                {l.name}
                              </span>
                              {isIgnored && (
                                <span className="rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.2 text-[9.5px] font-bold dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
                                  Excluded from Queues
                                </span>
                              )}
                              <span className="rounded-full bg-stone-100 text-stone-600 border border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700 px-2 py-0.2 text-[10px] font-semibold">
                                {l.count} {l.count === 1 ? "contact" : "contacts"}
                              </span>
                            </div>

                            {l.description && (
                              <p className="text-[11.5px] text-stone-500 dark:text-stone-400 line-clamp-2 pl-5">
                                {l.description}
                              </p>
                            )}

                            <p className="text-[10px] text-stone-400 dark:text-stone-500 pl-5">
                              Created {new Date(l.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                            </p>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditingList(l)}
                              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:text-stone-200 dark:hover:bg-stone-800 transition-colors"
                              title="Edit list name or description"
                            >
                              <Edit2 className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingList(l)}
                              className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/30 transition-colors"
                              title="Delete list"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Delete List Confirmation Modal */}
        {deletingList && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-stone-900 p-5 shadow-2xl border border-stone-200 dark:border-stone-800 space-y-4">
              <div className="flex items-start gap-3">
                <span className="p-2 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 shrink-0">
                  <AlertTriangle className="size-5" />
                </span>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-stone-900 dark:text-stone-100">
                    Delete "{deletingList.name}"?
                  </h4>
                  <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
                    This list currently contains{" "}
                    <strong>{deletingList.count} {deletingList.count === 1 ? "contact" : "contacts"}</strong>.
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-stone-50 dark:bg-stone-950/80 p-3 border border-stone-200/80 dark:border-stone-800 text-[11.5px] text-stone-600 dark:text-stone-300 leading-relaxed">
                <p className="font-semibold text-stone-800 dark:text-stone-200 mb-0.5">
                  Safe Deletion:
                </p>
                Contacts in this list will <strong>not</strong> be deleted, and their engagement stats and notes remain intact. Only this list category and memberships will be removed.
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDeletingList}
                  onClick={() => setDeletingList(null)}
                  className="text-xs rounded-lg"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isDeletingList}
                  onClick={handleDeleteListConfirm}
                  className="text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-xs"
                >
                  {isDeletingList ? "Deleting…" : "Delete List"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Drawer Footer for Queue Rules Tab */}
        {activeTab === "queue" && (
          <div className="p-4 border-t border-stone-200/80 bg-white dark:bg-stone-900 dark:border-stone-800 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={saving || loading}
              className="text-stone-500 hover:text-stone-800 text-xs"
            >
              <RotateCcw className="size-3.5 mr-1" /> Reset Defaults
            </Button>

            <div className="flex items-center gap-2">
              {savedNotice && (
                <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1 animate-in fade-in">
                  <Check className="size-3.5" /> Saved!
                </span>
              )}
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || loading}
                className="text-xs font-semibold bg-[#191817] hover:bg-[#302e2c] text-white px-4 h-8.5 rounded-full shadow-xs"
              >
                {saving ? "Saving…" : "Save Preferences"}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
