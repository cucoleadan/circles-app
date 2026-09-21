import { useCallback, useEffect, useState } from "react"
import { Bookmark, Key, Puzzle, Settings, Sparkles } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import type { ListRecord, PriorityQueueSettings, UserSettings } from "../lib/types"
import {
  SettingsConnectionTab,
  type SubstackConnectionInfo,
} from "./settings/settings-connection-tab"
import { SettingsExtensionTab } from "./settings/settings-extension-tab"
import { SettingsListsTab } from "./settings/settings-lists-tab"
import { SettingsQueueTab } from "./settings/settings-queue-tab"

export type { SubstackConnectionInfo }

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

  async function handleSaveQueue() {
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

  function handleResetQueue() {
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

          {/* Navigation Tabs - 2x2 Grid */}
          <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-stone-100/90 dark:bg-stone-800/80 rounded-xl mt-3 text-xs border border-stone-200/60 dark:border-stone-800">
            <button
              type="button"
              onClick={() => setActiveTab("connection")}
              className={`py-2 px-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-all text-xs select-none min-w-0 ${
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
              className={`py-2 px-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-all text-xs select-none min-w-0 ${
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
              className={`py-2 px-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-all text-xs select-none min-w-0 ${
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
              className={`py-2 px-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-all text-xs select-none min-w-0 ${
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
            <SettingsConnectionTab
              connection={connection}
              connectionLoading={connectionLoading}
              connectionBusy={connectionBusy}
              connectionError={connectionError}
              connectionSuccess={connectionSuccess}
              cookieInput={cookieInput}
              setCookieInput={setCookieInput}
              publicationUrlInput={publicationUrlInput}
              setPublicationUrlInput={setPublicationUrlInput}
              showToken={showToken}
              setShowToken={setShowToken}
              onSaveConnection={handleSaveConnection}
              onDisconnect={handleDisconnect}
            />
          )}

          {activeTab === "queue" && (
            <SettingsQueueTab
              settings={settings}
              updateQueueParam={updateQueueParam}
              loading={loading}
              saving={saving}
              savedNotice={savedNotice}
              onSave={handleSaveQueue}
              onReset={handleResetQueue}
            />
          )}

          {activeTab === "lists" && (
            <SettingsListsTab
              lists={lists}
              onCreateList={onCreateList}
              onUpdateList={onUpdateList}
              onDeleteList={onDeleteList}
            />
          )}

          {activeTab === "extension" && <SettingsExtensionTab />}
        </div>
      </SheetContent>
    </Sheet>
  )
}
