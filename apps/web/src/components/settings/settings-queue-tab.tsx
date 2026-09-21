import { Check, Flame, HeartHandshake, RefreshCw, Repeat, RotateCcw, Sparkles } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Separator } from "@workspace/ui/components/separator"
import type { PriorityQueueSettings, UserSettings } from "../../lib/types"

export function SettingsQueueTab({
  settings,
  updateQueueParam,
  loading,
  saving,
  savedNotice,
  onSave,
  onReset,
}: {
  settings: UserSettings
  updateQueueParam: <K extends keyof PriorityQueueSettings>(
    key: K,
    value: PriorityQueueSettings[K]
  ) => void
  loading: boolean
  saving: boolean
  savedNotice: boolean
  onSave: () => void
  onReset: () => void
}) {
  const q = settings.priorityQueue

  if (loading) {
    return (
      <div className="py-12 text-center text-stone-400">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2 text-[#f15a3a]" />
        <p>Loading your preferences…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
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

      {/* Queue Rules Action Bar */}
      <div className="p-4 rounded-xl border border-stone-200/80 bg-white dark:bg-stone-900 dark:border-stone-800 flex items-center justify-between shadow-2xs">
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
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
            onClick={onSave}
            disabled={saving || loading}
            className="text-xs font-semibold bg-[#191817] hover:bg-[#302e2c] text-white px-4 h-8.5 rounded-full shadow-xs"
          >
            {saving ? "Saving…" : "Save Preferences"}
          </Button>
        </div>
      </div>
    </div>
  )
}
