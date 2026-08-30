import { useMemo, useState } from "react";
import { mockAstSimulation, mockPolicyProfiles } from "@/data/mockGovernanceData";
import { usePolicy } from "@/hooks/usePolicy";
import type { SafetyEnforcementMode } from "@/types/operations";

export function usePolicyEngine() {
  const [profile, setProfile] = useState<(typeof mockPolicyProfiles)[number]>("Production Safe");
  const [mode, setMode] = useState<SafetyEnforcementMode>("STRICT_GATED");
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [astSimulation, setAstSimulation] = useState(mockAstSimulation);
  // 5e: the read-only policy backend feeds the rule matrix and the AST canvas;
  // the fixture matrix falls back while the plane is unreachable.
  const { rules, loadedFromPlane, simulate } = usePolicy();

  const stats = useMemo(() => ({ active: rules.filter((rule) => rule.enabled).length, blacklisted: rules.filter((rule) => rule.severity === "CRITICAL_BLOCK").length, highRisk: rules.filter((rule) => rule.category === "DESTRUCTIVE_FS" || rule.category === "NETWORK_EXFIL").length, intercepted: 184 }), [rules]);
  return { profile, profiles: mockPolicyProfiles, mode, rules, stats, expandedRuleId, editorOpen, notice, astSimulation, onProfileChange: (value: string) => setProfile(value as (typeof mockPolicyProfiles)[number]), setMode, setExpandedRuleId, setEditorOpen,
    // Toggle + editor stay presentation affordances: the plane owns the matrix (5e is read-only server-side), so neither mutation persists.
    onToggleRule: () => setNotice(loadedFromPlane ? "Rule matrix is read-only — the control plane owns these rules." : "Showing the fixture matrix until the control plane is reachable."),
    onSaveRule: () => { setEditorOpen(false); setNotice("Policy is read-only on this control plane build — rule drafts are not persisted."); },
    onAnalyze: (command: string) => { void simulate(command).then(setAstSimulation); } };
}
