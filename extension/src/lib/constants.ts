export const APP_ORIGINS = [
  "https://circles.mhntwrkdan.dev",
  "http://localhost:4321",
  "http://127.0.0.1:4321",
] as const;

export const APP_ORIGIN = APP_ORIGINS[0];

export const EXTENSION_HEADER = "X-Circles-Extension";
export const EXTENSION_HEADER_VALUE = "v1";

export const CONNECT_FLOW_TIMEOUT_MS = 5 * 60_000;
export const CONNECT_POLL_INTERVAL_MS = 1_000;
export const AUTO_CONNECT_COOLDOWN_MS = 30 * 60_000;

export const SUBSTACK_SESSION_COOKIE = "substack.sid";
