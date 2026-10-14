import type { MiddlewareHandler } from "astro"

export const onRequest: MiddlewareHandler = async ({ url, request }, next) => {
  if (!url.pathname.startsWith("/.well-known/") || !["GET", "HEAD"].includes(request.method))
    return next()

  // Remotely managed tunnels may send discovery to the web service.
  const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3000"
  try {
    return await fetch(new URL(url.pathname + url.search, apiUrl), {
      method: request.method, redirect: "manual", signal: AbortSignal.timeout(10000),
    })
  } catch {
    return Response.json({ error: "OAuth discovery is temporarily unavailable" }, {
      status: 502, headers: { "cache-control": "no-store" },
    })
  }
}
