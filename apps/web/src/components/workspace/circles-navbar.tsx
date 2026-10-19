import {
  AlertTriangle,
  CircleDot,
  HelpCircle,
  LogOut,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { HistoryBackfill } from "../history-backfill"

export function CirclesNavbar({
  search,
  searchPlaceholder = "Search name or @handle…",
  onSearchChange,
  onOpenGuide,
  onOpenSettings,
  onOpenAdd,
  onSync,
  isSyncing,
  connectionStatus,
  onLogout,
}: {
  search: string
  searchPlaceholder?: string
  onSearchChange: (value: string) => void
  onOpenGuide: () => void
  onOpenSettings: (tab: "connection" | "queue" | "extension" | "lists") => void
  onOpenAdd: () => void
  onSync: () => void
  isSyncing: boolean
  connectionStatus: "active" | "expired" | "none"
  onLogout: () => void
}) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/80 dark:border-stone-800 dark:bg-stone-900/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="flex items-center gap-2 font-bold tracking-tight text-sm sm:text-base">
              <span className="flex size-7 items-center justify-center rounded-lg bg-[#f15a3a] text-white shadow-xs">
                <CircleDot className="size-4" />
              </span>
              <span>Circles</span>
            </div>
            <span className="hidden md:inline-block rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-0.5 text-[11px] font-medium text-stone-600 dark:text-stone-300">
              CRM & Relationships
            </span>
          </div>

          {/* Search */}
          <div className="flex-1 max-w-md mx-1 sm:mx-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-stone-400" />
              <Input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="pl-9 h-8.5 sm:h-9 text-xs bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800 rounded"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <div className="hidden sm:inline-flex">
              <HistoryBackfill />
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 sm:h-8.5 rounded text-xs font-medium border-stone-200 px-2.5 sm:px-3"
              title="Write and schedule Notes"
            >
              <a href="/notes">
                <PenLine className="size-3.5 text-[#f15a3a] sm:mr-1" />
                <span className="hidden sm:inline">Notes</span>
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenGuide}
              className="hidden sm:inline-flex h-8.5 rounded text-xs font-medium border-stone-200"
              title="Badge & Scoring Guide"
            >
              <HelpCircle className="size-3.5 mr-1 text-stone-500" />
              <span>Guide</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={onSync}
              disabled={isSyncing}
              className="h-8 sm:h-8.5 rounded text-xs font-medium border-stone-200 px-2.5 sm:px-3"
              title="View Substack sync status"
            >
              <RefreshCw
                className={`size-3.5 ${isSyncing ? "animate-spin text-[#f15a3a]" : ""} sm:mr-1.5`}
              />
              <span className="hidden sm:inline">Sync</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenSettings("connection")}
              className={`h-8 sm:h-8.5 rounded text-xs font-medium border-stone-200 px-2.5 sm:px-3 relative ${
                connectionStatus === "expired"
                  ? "border-rose-300 text-rose-700 bg-rose-50/70 dark:bg-rose-950/30 dark:border-rose-800"
                  : ""
              }`}
              title="Settings & Substack Connection"
            >
              <Settings
                className={`size-3.5 ${
                  connectionStatus === "expired" ? "text-rose-600 dark:text-rose-400" : "text-stone-500"
                } sm:mr-1`}
              />
              <span className="hidden sm:inline">Settings</span>
              {connectionStatus === "expired" && (
                <span className="ml-1 size-1.5 rounded-full bg-rose-500 animate-pulse" />
              )}
            </Button>

            <Button
              size="sm"
              onClick={onOpenAdd}
              className="h-8 sm:h-8.5 rounded bg-[#191817] hover:bg-[#302e2c] text-white text-xs font-semibold px-2.5 sm:px-3.5 shadow-xs"
              title="Add Person"
            >
              <Plus className="size-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Add Person</span>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={onLogout}
              aria-label="Sign out"
              className="size-8 sm:size-8.5 rounded text-stone-500 hover:text-stone-800"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Expired Substack Session Banner */}
      {connectionStatus === "expired" && (
        <div className="bg-rose-50 border-b border-rose-200/90 dark:bg-rose-950/40 dark:border-rose-900/60 px-4 sm:px-6 py-2.5 text-xs text-rose-900 dark:text-rose-200 flex items-center justify-between shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>
              <strong>Substack session expired:</strong> Background sync is paused because your session cookie is no longer valid.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenSettings("connection")}
            className="h-7 text-xs border-rose-300 bg-white hover:bg-rose-50 text-rose-800 dark:bg-stone-900 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/50 rounded font-medium shadow-2xs"
          >
            Update Cookie
          </Button>
        </div>
      )}
    </>
  )
}
