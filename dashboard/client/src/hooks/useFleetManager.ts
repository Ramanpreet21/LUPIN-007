import { useMemo, useState } from "react";
import { mockFleetData } from "@/data/mockFleetData";
import type { FleetEnvironment, TargetNode } from "@/types/operations";

export function useFleetManager() {
  const [query, setQuery] = useState("");
  const [environment, setEnvironment] = useState<FleetEnvironment>("all");
  const [selectedNode, setSelectedNode] = useState<TargetNode | null>(null);
  const [notice, setNotice] = useState("");
  const nodes = useMemo(() => mockFleetData.filter((node) => {
    const matchesEnvironment = environment === "all" || node.environmentTag === environment;
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || [node.hostname, node.ipAddress, node.status, node.environmentTag, ...node.tags].join(" ").toLowerCase().includes(needle);
    return matchesEnvironment && matchesQuery;
  }), [environment, query]);
  return { nodes, query, environment, selectedNode, notice, setQuery, setEnvironment, setSelectedNode, onRegisterTarget: () => setNotice("Target registration form is ready for a streaming data adapter."), onConnectSubshell: (node: TargetNode) => setNotice(`Subshell request queued for ${node.hostname}.`), onSpawnTwin: (node: TargetNode) => setNotice(`Twin container request staged from ${node.hostname}.`), onHealthCheck: (node: TargetNode) => setNotice(`Health probe sent to ${node.hostname}.`) };
}
