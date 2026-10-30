// Self-healing watchdog. The recurring sync:activity job is the worker's
// heartbeat: when it (or the loop itself) has only failed for an hour, alert
// and exit so Docker's restart policy starts a fresh container. A restart
// re-reads DNS and network state, which is what broke on 2026-10-29.
// ponytail: global, not per connection; one account stuck on a 403 is masked
// by another that still syncs. Track per connection if that starts to matter.

export const UNHEALTHY_AFTER_MS = 60 * 60_000

const startedAt = Date.now()
let lastSuccessAt = 0
let lastFailureAt = 0
let lastError = ""

export function recordSuccess() {
  lastSuccessAt = Date.now()
}

export function recordFailure(message: string) {
  lastFailureAt = Date.now()
  lastError = message.slice(0, 300)
}

/** The failure to report once nothing has succeeded for an hour, else null. */
export function unhealthyReason(now = Date.now()): string | null {
  if (lastFailureAt <= lastSuccessAt) return null
  const healthySince = Math.max(lastSuccessAt, startedAt)
  if (now - healthySince < UNHEALTHY_AFTER_MS) return null
  const minutes = Math.round((now - healthySince) / 60_000)
  return `No successful activity sync for ${minutes} min. Last error: ${lastError}`
}

/** Best effort: works with Slack (`text`) and Discord (`content`) webhooks. */
export async function sendAlert(message: string) {
  const url = process.env.ALERT_WEBHOOK_URL
  if (!url) return
  const text = `[Circles worker] ${message}`
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text }),
    })
    if (!res.ok) console.error(`[Circles Worker] Alert webhook answered ${res.status}`)
  } catch (err: any) {
    console.error("[Circles Worker] Alert webhook failed:", err?.message)
  }
}
