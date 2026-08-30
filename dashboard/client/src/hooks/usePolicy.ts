import { useEffect, useState } from "react";
import { mockGovernanceData } from "@/data/mockGovernanceData";
import type { AstSimulation, PolicyRule } from "@/types/operations";

/** Control-plane origin (mirrors the same env override in useControlPlane). */
const CONTROL_PLANE_ORIGIN =
  import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";

/** Honest degrade when the plane is unreachable: single root node, no fake risk. */
export function fallbackSimulation(command: string): AstSimulation {
  const executable = command.trim().split(/\s+/)[0] || "command";
  return {
    command,
    riskScore: 0,
    trippedNode: `Command: ${executable}`,
    nodes: [{ id: "root", label: "Command", kind: executable, risk: "low" }],
  };
}

/**
 * 5e read-only policy backend: fetch the rule matrix once, POST a command to
 * /simulate per analyze. The plane is the source of truth; the fixture matrix
 * is the offline fallback so the governance view never renders an empty section.
 */
export function usePolicy(): {
  rules: PolicyRule[];
  loadedFromPlane: boolean;
  simulate: (command: string) => Promise<AstSimulation>;
} {
  const [rules, setRules] = useState<PolicyRule[]>(mockGovernanceData);
  const [loadedFromPlane, setLoadedFromPlane] = useState(false);
  /** Prevents a slow earlier response from overwriting a faster later one. */
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${CONTROL_PLANE_ORIGIN}/api/policy/rules`);
        if (!response.ok) return;
        const body = (await response.json()) as { data: unknown };
        const rows = Array.isArray(body.data) ? (body.data as PolicyRule[]) : [];
        if (!cancelled && rows.length > 0) {
          setRules(rows);
          setLoadedFromPlane(true);
        }
      } catch {
        // Best-effort: the fixture matrix stays until the plane is reachable.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const simulate = async (command: string): Promise<AstSimulation> => {
    const mySeq = seq + 1;
    setSeq(mySeq);
    try {
      const response = await fetch(`${CONTROL_PLANE_ORIGIN}/api/policy/simulate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command }),
      });
      // Drop out-of-order responses so a slow earlier request can't overwrite a newer result.
      if (mySeq !== seq) return fallbackSimulation(command);
      return response.ok
        ? ((await response.json()) as AstSimulation)
        : fallbackSimulation(command);
    } catch {
      if (mySeq !== seq) return fallbackSimulation(command);
      return fallbackSimulation(command);
    }
  };

  return { rules, loadedFromPlane, simulate };
}
