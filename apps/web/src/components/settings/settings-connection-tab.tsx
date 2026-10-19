import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Key,
  Puzzle,
  RefreshCw,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { extensionStoreUrl } from "./settings-extension-tab"

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

export function SettingsConnectionTab({
  connection,
  connectionLoading,
  connectionBusy,
  connectionError,
  connectionSuccess,
  cookieInput,
  setCookieInput,
  publicationUrlInput,
  setPublicationUrlInput,
  showToken,
  setShowToken,
  onSaveConnection,
  onDisconnect,
}: {
  connection: SubstackConnectionInfo | null
  connectionLoading: boolean
  connectionBusy: boolean
  connectionError: string | null
  connectionSuccess: string | null
  cookieInput: string
  setCookieInput: (val: string) => void
  publicationUrlInput: string
  setPublicationUrlInput: (val: string) => void
  showToken: boolean
  setShowToken: (val: boolean) => void
  onSaveConnection: () => void
  onDisconnect: () => void
}) {
  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" asChild>
        <a href="/mcp">Connected AI agents</a>
      </Button>
      {/* Current Status Card */}
      <div className="rounded border border-stone-200/80 bg-white p-3.5 shadow-none dark:border-stone-800 dark:bg-stone-900 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="size-3.5 text-[#f15a3a]" />
            <h3 className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-sm">
              Current Substack Connection
            </h3>
          </div>
          {connectionLoading ? (
            <span className="text-[10px] text-muted-foreground">Checking…</span>
          ) : !connection ? (
            <span className="rounded bg-stone-100 text-stone-600 border border-stone-200 px-2 py-0.5 text-[10px] font-semibold dark:bg-stone-800 dark:text-stone-400">
              Not Connected
            </span>
          ) : connection.status === "active" ? (
            <span className="rounded bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Active &amp; Connected
            </span>
          ) : (
            <span className="rounded bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 text-[10px] font-semibold dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 flex items-center gap-1 animate-pulse">
              <AlertTriangle className="size-3" /> Session Expired
            </span>
          )}
        </div>

        {connection ? (
          <div className="space-y-1.5 pt-0.5">
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
          <div className="rounded bg-rose-50/80 border border-rose-200/80 p-2.5 text-rose-800 dark:bg-rose-950/30 dark:border-rose-900/40 dark:text-rose-300 text-[11.5px] space-y-1">
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
      <div className="rounded border border-stone-200/80 bg-white p-3.5 shadow-none dark:border-stone-800 dark:bg-stone-900 space-y-3">
        <div>
          <h4 className="font-bold text-stone-900 dark:text-stone-100 text-xs sm:text-sm">
            {connection ? "Update Session Cookie" : "Connect Substack Account"}
          </h4>
          <p className="text-muted-foreground text-[11px] mt-0.5">
            Circles communicates securely with Substack's private API using your account session cookie.
          </p>
        </div>

        {/* Instructions Box */}
        <div className="rounded bg-stone-50 border border-stone-200/70 dark:bg-stone-950 dark:border-stone-800/80 p-2.5 text-[11px] text-stone-600 dark:text-stone-400 space-y-1">
          <div className="font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
            <Info className="size-3.5 text-[#f15a3a]" /> How to find your session cookie:
          </div>
          <ol className="list-decimal list-inside space-y-0.5 pl-0.5 text-[10.5px]">
            <li>Open and log in to <strong className="text-stone-800 dark:text-stone-200">substack.com</strong> in your browser.</li>
            <li>Press <kbd className="px-1 py-0.5 bg-stone-200 dark:bg-stone-800 rounded text-[9.5px]">F12</kbd> (or right-click → <em>Inspect</em>) to open Developer Tools.</li>
            <li>Go to <strong className="text-stone-800 dark:text-stone-200">Application</strong> (or <strong className="text-stone-800 dark:text-stone-200">Storage</strong>) → <strong className="text-stone-800 dark:text-stone-200">Cookies</strong> → <code className="text-[10px]">https://substack.com</code>.</li>
            <li>Find <strong className="text-stone-800 dark:text-stone-200">substack.sid</strong> and copy its <strong>Value</strong>.</li>
          </ol>
        </div>

        {connectionError && (
          <div className="rounded bg-rose-50 border border-rose-200 p-2.5 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300 text-[11px] flex items-start gap-2">
            <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
            <span>{connectionError}</span>
          </div>
        )}

        {connectionSuccess && (
          <div className="rounded bg-emerald-50 border border-emerald-200 p-2.5 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300 text-[11px] flex items-center gap-2">
            <Check className="size-3.5 shrink-0" />
            <span>{connectionSuccess}</span>
          </div>
        )}

        <div className="space-y-2.5 pt-0.5">
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
              className="h-8 text-xs bg-stone-50 dark:bg-stone-950 font-mono rounded"
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
              className="h-8 text-xs bg-stone-50 dark:bg-stone-950 rounded"
            />
          </div>

          <div className="pt-1.5 flex items-center justify-between">
            {connection ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onDisconnect}
                disabled={connectionBusy}
                className="text-xs text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-900/50 dark:hover:bg-rose-950/30 h-7.5 rounded px-3"
              >
                Disconnect
              </Button>
            ) : (
              <div />
            )}

            <Button
              type="button"
              size="sm"
              onClick={onSaveConnection}
              disabled={connectionBusy || !cookieInput.trim()}
              className="text-xs font-semibold bg-[#f15a3a] hover:bg-[#d94a2b] text-white px-3.5 h-7.5 rounded shadow-xs transition-all"
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
      <div className="rounded border border-stone-200/80 bg-white p-3 shadow-none dark:border-stone-800 dark:bg-stone-900 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className="size-8 rounded bg-gradient-to-br from-[#f15a3a] to-[#ff7e5f] text-white flex items-center justify-center shrink-0 shadow-xs mt-0.5">
            <Puzzle className="size-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="font-bold text-stone-900 dark:text-stone-100 text-xs leading-snug">
              Circles Companion Extension
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Capture outbound likes, restacks, and comments while browsing Substack.
            </p>
          </div>
        </div>
        <a
          href={extensionStoreUrl()}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 inline-flex items-center gap-1.5 rounded bg-[#f15a3a] hover:bg-[#d94828] text-white px-3 py-1.5 text-xs font-semibold shadow-xs transition-colors"
        >
          Install
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  )
}
