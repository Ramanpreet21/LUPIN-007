import { describe, expect, it } from "vitest";
import { countBlockedExecutions, isPlaneExecuting } from "./useControlPlane";
import type { DeckIncident } from "@/types/control-plane";

/** Builds a deck row per status; incident_id is only an identity key. */
function incidents(...statuses: DeckIncident["status"][]): DeckIncident[] {
  return statuses.map((status, index) => ({
    incident_id: `inc-${index}-${status}`,
    status,
    thinking: [],
    pending: null,
  }));
}

describe("isPlaneExecuting", () => {
  it("is executing while an incident is mid-diagnosis", () => {
    expect(isPlaneExecuting(incidents("diagnosing"))).toBe(true);
  });

  it("stays executing through the approved-to-completion window", () => {
    // decide() moves a row to `approved` before execution_complete finalizes it.
    expect(isPlaneExecuting(incidents("approved"))).toBe(true);
  });

  it("is paused while an approval decision is pending", () => {
    expect(isPlaneExecuting(incidents("awaiting_approval"))).toBe(false);
  });

  it("is not executing after a final decision", () => {
    expect(isPlaneExecuting(incidents("completed", "failed", "rejected"))).toBe(false);
  });

  it("is false for an empty deck", () => {
    expect(isPlaneExecuting([])).toBe(false);
  });
});

describe("countBlockedExecutions", () => {
  it("counts rejected and failed executions", () => {
    expect(countBlockedExecutions(incidents("rejected", "failed", "completed", "approved"))).toBe(2);
  });

  it("counts zero when nothing was blocked", () => {
    expect(countBlockedExecutions(incidents("diagnosing", "completed"))).toBe(0);
  });
});
