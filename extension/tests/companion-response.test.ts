import { describe, expect, it } from "bun:test";
import { parseCompanionResponse } from "../src/lib/companion-response";

describe("companion response", () => {
  it("preserves the API appState envelope without nesting it again", () => {
    const response = parseCompanionResponse({
      ok: true,
      appState: {
        connection: {
          id: "connection-1",
          publicationUrl: "https://example.substack.com",
          profile: { id: "profile-1", name: "Example", handle: "example" },
          lastVerifiedAt: "2026-09-17T12:00:00.000Z",
          createdAt: "2026-09-17T12:00:00.000Z",
          updatedAt: "2026-09-17T12:00:00.000Z",
        },
        lists: [],
        handles: [],
        members: [],
        user: { id: "user-1", email: "user@example.com" },
      },
    });

    expect(response.ok).toBe(true);
    expect(response.appState?.connection?.id).toBe("connection-1");
    expect(response.appState).not.toHaveProperty("appState");
  });

  it("preserves an API authentication failure", () => {
    expect(
      parseCompanionResponse({
        ok: false,
        needsAuth: true,
        message: "Log in to Circles first.",
      }),
    ).toEqual({
      ok: false,
      needsAuth: true,
      message: "Log in to Circles first.",
    });
  });

  it("rejects a successful response without app state", () => {
    expect(parseCompanionResponse({ ok: true })).toEqual({
      ok: false,
      message: "Circles returned an invalid companion response.",
    });
  });
});
