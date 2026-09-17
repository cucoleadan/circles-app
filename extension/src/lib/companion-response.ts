import type { BridgeResponse } from "./types";

export function parseCompanionResponse(payload: unknown): BridgeResponse {
  if (!payload || typeof payload !== "object") {
    return { ok: false, message: "Circles returned an invalid companion response." };
  }

  const response = payload as BridgeResponse;
  if (response.ok !== true) {
    return {
      ok: false,
      needsAuth: response.needsAuth,
      message: response.message ?? "Circles could not load the companion state.",
    };
  }

  if (!response.appState || typeof response.appState !== "object") {
    return { ok: false, message: "Circles returned an invalid companion response." };
  }

  return response;
}
