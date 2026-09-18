import { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  HeartHandshake,
  Info,
  Key,
  RefreshCw,
  Repeat,
  RotateCcw,
  Settings,
  Sparkles,
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
import type { PriorityQueueSettings, UserSettings } from "../lib/types"

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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: "connection" | "queue"
  onSaved?: () => void
  onConnectionUpdated?: () => void
}) {
  const [activeTab, setActiveTab] = useState<"connection" | "queue">(initialTab)
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
                Manage your Substack session credentials and smart engagement algorithms.
              </SheetDescription>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-2 pt-3 border-t border-stone-100 dark:border-stone-800 mt-3 -mb-1">
            <button
              type="button"
              onClick={() => setActiveTab("connection")}
              className={`pb-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all ${
                activeTab === "connection"
                  ? "border-[#f15a3a] text-[#f15a3a]"
                  : "border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
              }`}
            >
              <Key className="size-3.5" />
              Substack Connection
              {connection?.status === "expired" && (
                <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("queue")}
              className={`pb-2 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all ${
                activeTab === "queue"
                  ? "border-[#f15a3a] text-[#f15a3a]"
                  : "border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
              }`}
            >
              <Sparkles className="size-3.5" />
              Smart Queue Rules
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
        </div>

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
