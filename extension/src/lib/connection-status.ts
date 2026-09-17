import type { FlowState } from "./types";

/** A recovered live bridge supersedes its previous transport error, not other failures. */
export function recoveredFlow(flow: FlowState, connected: boolean, running: boolean): FlowState {
  if (running || !connected) return flow;
  if (flow.phase === "done") return { phase: "idle" };
  if (flow.phase === "failed" && /Reload the StackedHQ|Open the StackedHQ|Could not reach the StackedHQ|StackedHQ did not confirm|Connection was interrupted/.test(flow.message)) {
    return { phase: "idle" };
  }
  return flow;
}
