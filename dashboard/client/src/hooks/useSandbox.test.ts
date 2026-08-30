import { describe, expect, it } from "vitest";
import { asSandboxResourceLimits, mergeSandboxStatus } from "./useSandbox";
import type { SandboxTwinData } from "@/types/workspace-cards";

const fixture: SandboxTwinData = {
  containerId: "twin-88a2",
  state: "ACTIVE_ISOLATION",
  resourceLimits: { cpuCapCores: 2, cpuUsedPercent: 38, memoryCapMb: 1024, memoryUsedMb: 418 },
  isolationFlags: { networkDisabled: true, readOnlyHostMount: true },
};

describe("asSandboxResourceLimits", () => {
  it("picks only known numeric keys and drops non-numeric entries", () => {
    const limits = asSandboxResourceLimits({ cpuUsedPercent: 51.5, memoryUsedMb: 640, state: "bogus", cpuCapCores: "2" });
    expect(limits).toEqual({ cpuUsedPercent: 51.5, memoryUsedMb: 640 });
  });

  it("returns null for garbage payloads", () => {
    expect(asSandboxResourceLimits(null)).toBeNull();
    expect(asSandboxResourceLimits("nope")).toBeNull();
    expect(asSandboxResourceLimits({})).toBeNull();
  });
});

describe("mergeSandboxStatus", () => {
  it("keeps the fixture untouched when metrics are unavailable", () => {
    const merged = mergeSandboxStatus(fixture, { metricsAvailable: false, status: null });
    expect(merged).toEqual(fixture);
  });

  it("overlays a known live state and numeric limits over the fixture", () => {
    const merged = mergeSandboxStatus(fixture, {
      metricsAvailable: true,
      status: { state: "RUNNING_TEST_BUILD", resourceLimits: { cpuUsedPercent: 71, memoryUsedMb: 880 } },
    });
    expect(merged.state).toBe("RUNNING_TEST_BUILD");
    expect(merged.resourceLimits.cpuUsedPercent).toBe(71);
    expect(merged.resourceLimits.memoryUsedMb).toBe(880);
    // Untouched keys stay on the fixture.
    expect(merged.resourceLimits.cpuCapCores).toBe(2);
    expect(merged.isolationFlags).toEqual(fixture.isolationFlags);
  });

  it("ignores an unknown live state string", () => {
    const merged = mergeSandboxStatus(fixture, {
      metricsAvailable: true,
      status: { state: "SOME_NEW_TRUEFORGE_STATE", resourceLimits: undefined },
    });
    expect(merged.state).toBe("ACTIVE_ISOLATION");
  });
});
