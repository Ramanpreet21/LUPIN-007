import { useEffect, useMemo, useState } from "react";
import type { ArchivedIncident, IncidentSeverity } from "@/types/operations";

/** Control-plane origin (mirrors the same env override in useControlPlane). */
const CONTROL_PLANE_ORIGIN =
  import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";

/** Client-side date-range cutoffs keyed by the ArchiveView select values. */
const RANGE_CUTOFF_MS: Record<string, number> = {
  "24_HOURS": 24 * 60 * 60 * 1000,
  "7_DAYS": 7 * 24 * 60 * 60 * 1000,
  "30_DAYS": 30 * 24 * 60 * 60 * 1000,
  "90_DAYS": 90 * 24 * 60 * 60 * 1000,
};

const SEVERITY_MAP: Record<string, IncidentSeverity> = {
  critical: "P1_CRITICAL",
  high: "P2_HIGH",
  medium: "P3_MEDIUM",
  warning: "P4_LOW",
  low: "P4_LOW",
  info: "P4_LOW",
};

/** Minimal view of the incident rows returned by GET /incidents. */
interface BackendIncident {
  id: string;
  status: string;
  createdAt: string;
  alert?: {
    service_name: string;
    target_host: string;
    severity: string;
    alert_summary?: string;
  };
  proposedCommands?: string[];
}

function terminalStatusOf(status: string): boolean {
  return status === "completed" || status === "failed" || status === "rejected";
}

function severityOf(incident: BackendIncident): IncidentSeverity {
  const raw = incident.alert?.severity ?? "";
  return SEVERITY_MAP[raw.toLowerCase()] ?? "P3_MEDIUM";
}

function mapIncident(incident: BackendIncident): ArchivedIncident {
  const alert = incident.alert;
  return {
    id: incident.id,
    title: alert?.alert_summary?.trim()
      ? alert.alert_summary.trim()
      : alert
        ? `${alert.service_name} on ${alert.target_host}`
        : incident.id,
    timestamp: incident.createdAt
      ? new Date(incident.createdAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : "—",
    duration: "—", // no backend duration yet; archive renders the column as-is
    severity: severityOf(incident),
    status: terminalStatusOf(incident.status) ? "RESOLVED" : "ARCHIVED",
    targetHost: alert?.target_host ?? "—",
    approverOperator: "—",
    totalCommandsExecuted: incident.proposedCommands?.length ?? 0,
    agentVersion: "—",
    rootCauseCategory: "—",
    approvalEvents: [],
  };
}

export function useIncidentArchive(pollMs = 10_000) {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity | "ALL">("ALL");
  const [dateRange, setDateRange] = useState("90_DAYS");
  const [selectedIncident, setSelectedIncident] = useState<ArchivedIncident | null>(null);
  const [replayTab, setReplayTab] = useState<"waterfall" | "approvals" | "diff" | "rca">("waterfall");
  const [notice, setNotice] = useState("");
  const [incidents, setIncidents] = useState<BackendIncident[]>([]);

  // Live archive (PR #4 4e): fetch on mount and poll every `pollMs` so the
  // archive tracks the control plane while the dashboard is open. Date-range
  // filtering is client-side.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${CONTROL_PLANE_ORIGIN}/incidents?status=resolved&limit=50`);
        if (!response.ok) return;
        const body = (await response.json()) as { data: unknown };
        if (!cancelled && Array.isArray(body.data)) setIncidents(body.data as BackendIncident[]);
      } catch {
        // Best-effort read view: keep whatever was already loaded.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  const visibleIncidents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const now = Date.now();
    const cutoffMs = RANGE_CUTOFF_MS[dateRange] ?? RANGE_CUTOFF_MS["90_DAYS"];
    return incidents
      .filter((incident) => {
        if (severity !== "ALL" && severityOf(incident) !== severity) return false;
        // Search the displayed title too: alert_summary is what mapIncident shows (qodo #2).
        const haystack = [incident.id, incident.alert?.service_name, incident.alert?.target_host, incident.alert?.alert_summary].join(" ").toLowerCase();
        if (needle && !haystack.includes(needle)) return false;
        const created = incident.createdAt ? Date.parse(incident.createdAt) : NaN;
        return !Number.isFinite(created) || now - created <= cutoffMs;
      })
      .map(mapIncident);
  }, [incidents, query, severity, dateRange]);

  return { incidents: visibleIncidents, query, severity, dateRange, selectedIncident, replayTab, notice, setQuery, setSeverity, setDateRange, setSelectedIncident, setReplayTab, onExport: (incident: ArchivedIncident, format: "JSON" | "RCA") => setNotice(`${format} export prepared for ${incident.id}.`), onReplay: (incident: ArchivedIncident | null) => { setSelectedIncident(incident); if (incident) setReplayTab("waterfall"); } };
}
