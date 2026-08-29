import { useMemo, useState } from "react";
import { mockArchiveData } from "@/data/mockArchiveData";
import type { ArchivedIncident, IncidentSeverity } from "@/types/operations";

export function useIncidentArchive() {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity | "ALL">("ALL");
  const [dateRange, setDateRange] = useState("90_DAYS");
  const [selectedIncident, setSelectedIncident] = useState<ArchivedIncident | null>(null);
  const [replayTab, setReplayTab] = useState<"waterfall" | "approvals" | "diff" | "rca">("waterfall");
  const [notice, setNotice] = useState("");
  const incidents = useMemo(() => mockArchiveData.filter((incident) => {
    const needle = query.trim().toLowerCase();
    return (severity === "ALL" || incident.severity === severity) && (!needle || [incident.id, incident.title, incident.targetHost, incident.rootCauseCategory].join(" ").toLowerCase().includes(needle));
  }), [query, severity]);
  return { incidents, query, severity, dateRange, selectedIncident, replayTab, notice, setQuery, setSeverity, setDateRange, setSelectedIncident, setReplayTab, onExport: (incident: ArchivedIncident, format: "JSON" | "RCA") => setNotice(`${format} export prepared for ${incident.id}.`), onReplay: (incident: ArchivedIncident | null) => { setSelectedIncident(incident); if (incident) setReplayTab("waterfall"); } };
}
