import { grantedAppOrigin } from "./app-origin"

// The panel and background call the paired Circles server directly. The extension holds host
// permission for that origin, so Chrome sends its login cookie; the header
// passes the API's write-origin check (apps/api/src/index.ts).

export class CirclesError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function circles<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const origin = await grantedAppOrigin()
  if (!origin) throw new CirclesError("Pair your Circles server first.", 0)
  let response: Response
  try {
    response = await fetch(`${origin}${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: {
        "X-Circles-Extension": "v1",
        ...(init.body !== undefined && { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new CirclesError("Could not reach Circles.", 0)
  }
  if (response.status === 401 || (response.redirected && response.url.includes("/login"))) {
    throw new CirclesError("Log in to Circles first.", 401)
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
    throw new CirclesError(data?.error ?? data?.message ?? `Circles returned ${response.status}.`, response.status)
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}
