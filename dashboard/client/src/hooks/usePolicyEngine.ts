import { useMemo, useState } from "react";
import { mockAstSimulation, mockGovernanceData, mockPolicyProfiles } from "@/data/mockGovernanceData";
import type { PolicyRule, SafetyEnforcementMode } from "@/types/operations";

export function usePolicyEngine() {
  const [profile, setProfile] = useState<(typeof mockPolicyProfiles)[number]>("Production Safe");
  const [mode, setMode] = useState<SafetyEnforcementMode>("STRICT_GATED");
  const [rules, setRules] = useState<PolicyRule[]>(mockGovernanceData);
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const stats = useMemo(() => ({ active: rules.filter((rule) => rule.enabled).length, blacklisted: rules.filter((rule) => rule.severity === "CRITICAL_BLOCK").length, highRisk: rules.filter((rule) => rule.category === "DESTRUCTIVE_FS" || rule.category === "NETWORK_EXFIL").length, intercepted: 184 }), [rules]);
  return { profile, profiles: mockPolicyProfiles, mode, rules, stats, expandedRuleId, editorOpen, notice, astSimulation: mockAstSimulation, onProfileChange: (value: string) => setProfile(value as (typeof mockPolicyProfiles)[number]), setMode, setExpandedRuleId, setEditorOpen, onToggleRule: (id: string) => setRules((current) => current.map((rule) => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule)), onSaveRule: () => { setEditorOpen(false); setNotice("Custom rule draft validated locally; connect a policy adapter to persist it."); }, onAnalyze: (command: string) => setNotice(`Syntax inspection queued for: ${command}`) };
}
