import { useEffect, useMemo, useRef, useState } from "react";
import { CONTROL_PLANE_ORIGIN } from "@/hooks/useControlPlane";
import type { ArchivedIncident, IncidentSeverity } from "@/types/operations";

interface BackendIncident {
  id: string;
  alert: {
    service_name: string;
    target_host: string;
    severity?: string;
    alert_summary?: string;
  };
  status: string;
  createdAt: string;
  completedAt?: string;
  proposedCommand?: string;
  proposedCommands?: string[];
}

function mapSeverity(s?: string): IncidentSeverity {
  const norm = String(s || "").toLowerCase().trim();
  if (norm === "sev-1" || norm === "p1_critical" || norm === "critical") return "P1_CRITICAL";
  if (norm === "sev-2" || norm === "p2_high" || norm === "high" || norm === "warning") return "P2_HIGH";
  if (norm === "sev-3" || norm === "p3_medium" || norm === "medium") return "P3_MEDIUM";
  return "P4_LOW";
}

function mapBackendIncident(item: BackendIncident): ArchivedIncident & { createdMs: number } {
  const isTerminal = ["completed", "resolved", "failed", "rejected"].includes(item.status);
  const isSuccess = ["completed", "resolved"].includes(item.status);
  const started = new Date(item.createdAt || Date.now());
  const ended = item.completedAt ? new Date(item.completedAt) : null;
  const durationStr = ended
    ? `${Math.max(1, Math.round((ended.getTime() - started.getTime()) / 60000))}m`
    : "—";

  const service = item.alert?.service_name || "systemd";
  const host = item.alert?.target_host || "localhost";
  const cmd = item.proposedCommand || (item.proposedCommands && item.proposedCommands[0]);

  return {
    id: item.id,
    title: item.alert?.alert_summary || `${service} on ${host}`,
    timestamp: started.toISOString().replace("T", " · ").slice(0, 19) + " UTC",
    duration: durationStr,
    severity: mapSeverity(item.alert?.severity),
    status: isTerminal ? "RESOLVED" : "POST_MORTEM_PENDING",
    targetHost: host,
    approverOperator: "—",
    totalCommandsExecuted: isSuccess ? (cmd ? (item.proposedCommands?.length ?? 1) : 0) : 0,
    agentVersion: "—",
    rootCauseCategory: service,
    approvalEvents: [],
    createdMs: started.getTime(),
  };
}

const DATE_RANGE_MILLIS: Record<string, number> = {
  "24_HOURS": 24 * 60 * 60 * 1000,
  "7_DAYS": 7 * 24 * 60 * 60 * 1000,
  "30_DAYS": 30 * 24 * 60 * 60 * 1000,
  "90_DAYS": 90 * 24 * 60 * 60 * 1000,
};

export function useIncidentArchive() {
  const [liveIncidents, setLiveIncidents] = useState<Array<ArchivedIncident & { createdMs: number }> | null>(null);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity | "ALL">("ALL");
  const [dateRange, setDateRange] = useState("90_DAYS");
  const [selectedIncident, setSelectedIncident] = useState<ArchivedIncident | null>(null);
  const [replayTab, setReplayTab] = useState<"waterfall" | "approvals" | "diff" | "rca">("waterfall");
  const [notice, setNotice] = useState("");
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    let unmounted = false;
    const fetchIncidents = async () => {
      try {
        const res = await fetch(`${CONTROL_PLANE_ORIGIN}/incidents?status=resolved&limit=100`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data?: BackendIncident[] };
        if (!unmounted && Array.isArray(body.data)) {
          hasLoadedRef.current = true;
          setLiveIncidents(body.data.map(mapBackendIncident));
        }
      } catch {
        if (!unmounted && !hasLoadedRef.current) {
          setLiveIncidents([]);
        }
      }
    };
    void fetchIncidents();
    const timer = setInterval(() => void fetchIncidents(), 8000);
    return () => {
      unmounted = true;
      clearInterval(timer);
    };
  }, []);

  const allIncidents = useMemo(() => {
    return liveIncidents ?? [];
  }, [liveIncidents]);

  const incidents = useMemo(() => {
    const maxAge = DATE_RANGE_MILLIS[dateRange] ?? DATE_RANGE_MILLIS["90_DAYS"];
    const cutoff = Date.now() - maxAge;
    const needle = query.trim().toLowerCase();

    return allIncidents.filter((incident) => {
      if (incident.createdMs < cutoff) return false;
      if (severity !== "ALL" && incident.severity !== severity) return false;
      if (needle && ![incident.id, incident.title, incident.targetHost, incident.rootCauseCategory].join(" ").toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [allIncidents, query, severity, dateRange]);

  return {
    incidents,
    query,
    severity,
    dateRange,
    selectedIncident,
    replayTab,
    notice,
    setQuery,
    setSeverity,
    setDateRange,
    setSelectedIncident,
    setReplayTab,
    onExport: (incident: ArchivedIncident, format: "JSON" | "RCA") => setNotice(`${format} export prepared for ${incident.id}.`),
    onReplay: (incident: ArchivedIncident | null) => {
      setSelectedIncident(incident);
      if (incident) setReplayTab("waterfall");
    },
  };
}
