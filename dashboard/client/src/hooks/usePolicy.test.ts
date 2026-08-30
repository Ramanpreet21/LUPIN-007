import { describe, expect, it } from "vitest";
import { fallbackSimulation } from "./usePolicy";

describe("fallbackSimulation", () => {
  it("returns an honest single-root AST for an arbitrary command", () => {
    const sim = fallbackSimulation("rm -rf /data");
    expect(sim.command).toBe("rm -rf /data");
    expect(sim.riskScore).toBe(0);
    expect(sim.trippedNode).toBe("Command: rm");
    expect(sim.nodes).toEqual([{ id: "root", label: "Command", kind: "rm", risk: "low" }]);
  });

  it("handles a blank command without crashing", () => {
    const sim = fallbackSimulation("   ");
    expect(sim.trippedNode).toBe("Command: command");
    expect(sim.nodes[0].kind).toBe("command");
  });
});
