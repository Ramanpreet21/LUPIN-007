import { useEffect, useState } from "react";
import type { SandboxState, SandboxTwinData } from "@/types/workspace-cards";

/** Control-plane origin (mirrors the same env override in useControlPlane). */
const CONTROL_PLANE_ORIGIN =
  import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";

const KNOWN_STATES = ["ACTIVE_ISOLATION", "RUNNING_TEST_BUILD", "TEARDOWN_QUEUED"] as const;

/** Resource metrics the sandbox-status proxy may report (numeric subset only). */
export interface SandboxResourcePartial {
  cpuCapCores?: number;
  cpuUsedPercent?: number;
  memoryCapMb?: number;
  memoryUsedMb?: number;
}

export interface LiveSandboxStatus {
  state?: string;
  resourceLimits?: SandboxResourcePartial;
}

export interface SandboxStatusRelay {
  metricsAvailable: boolean;
  status: LiveSandboxStatus | null;
}

/** Shape-guard the proxy resourceLimits; unknown keys must never leak through. */
export function asSandboxResourceLimits(value: unknown): SandboxResourcePartial | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const numericKeys = ["cpuCapCores", "cpuUsedPercent", "memoryCapMb", "memoryUsedMb"] as const;
  const pick: SandboxResourcePartial = {};
  let picked = false;
  for (const key of numericKeys) {
    const n = raw[key];
    if (typeof n === "number" && Number.isFinite(n)) {
      pick[key] = n;
      picked = true;
    }
  }
  return picked ? pick : null;
}

/** 5f: overlay live proxy metrics on the fixture; any unknown piece falls back. */
export function mergeSandboxStatus(base: SandboxTwinData, relay: SandboxStatusRelay): SandboxTwinData {
  const live = relay.metricsAvailable ? relay.status : null;
  if (!live) return base;
  const next: SandboxTwinData = { ...base };
  if (live.state && (KNOWN_STATES as readonly string[]).includes(live.state)) {
    next.state = live.state as SandboxState;
  }
  if (live.resourceLimits) {
    next.resourceLimits = { ...base.resourceLimits, ...live.resourceLimits };
  }
  return next;
}

/**
 * Poll the sandbox-status REST proxy while a live sandbox exists. The proxy is
 * best-effort: an unconfigured plane — or an unknown TrueForge status path for
 * the 5f flagged endpoint — returns `metricsAvailable:false`, and callers keep
 * their fixture payload. No polling happens without a sandbox_id.
 */
export function useSandbox(sandboxId: string | null, pollMs = 10_000): SandboxStatusRelay {
  const [relay, setRelay] = useState<SandboxStatusRelay>({ metricsAvailable: false, status: null });

  useEffect(() => {
    if (!sandboxId) {
      setRelay({ metricsAvailable: false, status: null });
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${CONTROL_PLANE_ORIGIN}/api/sandbox/${encodeURIComponent(sandboxId)}/status`);
        const body = (await response.json().catch(() => ({}))) as {
          metricsAvailable?: boolean;
          state?: string;
          resourceLimits?: unknown;
        };
        if (cancelled) return;
        if (!response.ok || !body.metricsAvailable) {
          setRelay({ metricsAvailable: false, status: null });
          return;
        }
        setRelay({
          metricsAvailable: true,
          status: {
            state: typeof body.state === "string" ? body.state : undefined,
            resourceLimits: asSandboxResourceLimits(body.resourceLimits) ?? undefined,
          },
        });
      } catch {
        if (!cancelled) setRelay({ metricsAvailable: false, status: null });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sandboxId, pollMs]);

  return relay;
}
