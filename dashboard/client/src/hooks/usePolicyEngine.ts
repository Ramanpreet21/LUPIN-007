import { useCallback, useEffect, useMemo, useState } from "react";
import type { AstSimulation, PolicyRule, SafetyEnforcementMode } from "@/types/operations";

const API = import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";

const defaultAstSimulation: AstSimulation = {
  command: "find /var/log -type f -delete",
  riskScore: 82,
  trippedNode: "Action: -delete",
  nodes: [
    { id: "root", label: "Command", kind: "find", risk: "low" },
    { id: "path", label: "Path", kind: "/var/log", risk: "medium" },
    { id: "type", label: "Predicate", kind: "-type f", risk: "low" },
    { id: "delete", label: "Action", kind: "-delete", risk: "high" },
  ],
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function usePolicyEngine() {
  const [profile, setProfile] = useState<string>("Production Safe");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [mode, setMode] = useState<SafetyEnforcementMode>("STRICT_GATED");
  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [astSimulation, setAstSimulation] = useState<AstSimulation>(defaultAstSimulation);
  const [statsData, setStatsData] = useState({
    activeRules: 0,
    blacklistedBinaries: 0,
    highRiskPatterns: 0,
    interceptedCount: 0,
  });

  // Initial data load
  useEffect(() => {
    void (async () => {
      try {
        const [rulesRes, profilesRes, statsRes, settingsRes] = await Promise.all([
          apiFetch<{ data: PolicyRule[] }>("/api/policy/rules"),
          apiFetch<{ data: Array<{ name: string; is_active: boolean }> }>("/api/policy/profiles"),
          apiFetch<{ activeRules: number; blacklistedBinaries: number; highRiskPatterns: number; interceptedCount: number }>("/api/policy/stats"),
          apiFetch<Record<string, string>>("/api/settings"),
        ]);
        setRules(
          rulesRes.data.map((r) => ({
            ...r,
            binaryName: r.binaryName ?? r.name ?? "",
            forbiddenFlags: r.forbiddenFlags ?? [],
            reasonDescription: r.reasonDescription ?? "",
            matchExpression: r.matchExpression ?? r.regex ?? "",
          }))
        );
        const profileNames = profilesRes.data.map((p) => p.name);
        setProfiles(profileNames);
        const activeProfile = profilesRes.data.find((p) => p.is_active);
        if (activeProfile) setProfile(activeProfile.name);
        setStatsData(statsRes);
        if (settingsRes.enforcement_mode) setMode(settingsRes.enforcement_mode as SafetyEnforcementMode);
      } catch (err) {
        console.error("Failed to load policy data:", err);
      }
    })();
  }, []);

  const stats = useMemo(
    () => ({
      active: statsData.activeRules || rules.filter((r) => r.enabled).length,
      blacklisted: statsData.blacklistedBinaries || rules.filter((r) => r.severity === "CRITICAL_BLOCK").length,
      highRisk: statsData.highRiskPatterns || rules.filter((r) => r.category === "DESTRUCTIVE_FS" || r.category === "NETWORK_EXFIL").length,
      intercepted: statsData.interceptedCount,
      activeRules: statsData.activeRules,
      blacklistedBinaries: statsData.blacklistedBinaries,
      highRiskPatterns: statsData.highRiskPatterns,
      interceptedCount: statsData.interceptedCount,
    }),
    [statsData, rules]
  );

  const onProfileChange = useCallback(async (value: string) => {
    setProfile(value);
    try {
      await apiFetch(`/api/policy/profiles/${encodeURIComponent(value)}`, { method: "PUT" });
    } catch (err) {
      console.error("Failed to switch profile:", err);
    }
  }, []);

  const onToggleRule = useCallback(
    async (id: string) => {
      setRules((current) =>
        current.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule))
      );
      try {
        const rule = rules.find((r) => r.id === id);
        if (rule) {
          await apiFetch(`/api/policy/rules/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ enabled: !rule.enabled }),
          });
        }
      } catch (err) {
        console.error("Failed to toggle rule:", err);
        // Revert optimistic update
        setRules((current) =>
          current.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule))
        );
      }
    },
    [rules]
  );

  const onSaveRule = useCallback(async (ruleData?: Record<string, unknown>) => {
    setEditorOpen(false);
    if (!ruleData) return;
    try {
      const created = await apiFetch<PolicyRule>("/api/policy/rules", {
        method: "POST",
        body: JSON.stringify(ruleData),
      });
      setRules((current) => [
        ...current,
        {
          ...created,
          binaryName: created.binaryName ?? created.name ?? "",
          forbiddenFlags: created.forbiddenFlags ?? [],
          reasonDescription: created.reasonDescription ?? "",
          matchExpression: created.matchExpression ?? created.regex ?? "",
        },
      ]);
      setNotice("Policy rule created successfully.");
    } catch (err) {
      setNotice(`Failed to create rule: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const onAnalyze = useCallback(async (command: string) => {
    try {
      const result = await apiFetch<AstSimulation>("/api/policy/analyze", {
        method: "POST",
        body: JSON.stringify({ command }),
      });
      setAstSimulation(result);
      setNotice("");
    } catch (err) {
      setNotice(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const onModeChange = useCallback(async (newMode: SafetyEnforcementMode) => {
    setMode(newMode);
    try {
      await apiFetch("/api/policy/mode", {
        method: "PUT",
        body: JSON.stringify({ mode: newMode }),
      });
    } catch (err) {
      console.error("Failed to set mode:", err);
    }
  }, []);

  return {
    profile,
    profiles,
    mode,
    rules,
    stats,
    expandedRuleId,
    editorOpen,
    notice,
    astSimulation,
    onProfileChange,
    setMode: onModeChange,
    setExpandedRuleId,
    setEditorOpen,
    onToggleRule,
    onSaveRule,
    onAnalyze,
  };
}
