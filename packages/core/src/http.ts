export const DEFAULT_FETCH_TIMEOUT_MS = 30_000

let installed = false

/**
 * Give every outbound request a deadline. The Substack SDK and the raw audience
 * calls do not pass an abort signal, so a stalled upstream connection would
 * otherwise block the single worker loop or hold an API request open.
 * Requests that already carry their own signal keep it.
 */
export function installFetchTimeout(timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  if (installed) return
  installed = true
  const originalFetch = globalThis.fetch
  const timedFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const hasSignal = Boolean(init?.signal) || (typeof Request !== "undefined" && input instanceof Request && input.signal)
    if (hasSignal) return originalFetch(input, init)
    return originalFetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  }
  globalThis.fetch = Object.assign(timedFetch, originalFetch) as typeof fetch
}
