import { describe, expect, it } from "vitest";
import { recoveredFlow } from "../src/lib/connection-status";
import type { FlowState } from "../src/lib/types";

const stale: FlowState = { phase: "failed", flowId: "old", message: "Reload the StackedHQ tab once to activate the updated extension." };
describe("recovered connection status", () => {
  it("clears the stale reload error when the live app is connected", () => {
    expect(recoveredFlow(stale, true, false)).toEqual({ phase: "idle" });
  });
  it("does not hide a real bridge failure or an active attempt", () => {
    expect(recoveredFlow(stale, false, false)).toBe(stale);
    expect(recoveredFlow(stale, true, true)).toBe(stale);
  });
  it("preserves unrelated connection errors", () => {
    const failure: FlowState = { phase: "failed", flowId: "new", message: "Could not encrypt the Substack credential." };
    expect(recoveredFlow(failure, true, false)).toBe(failure);
  });
});
