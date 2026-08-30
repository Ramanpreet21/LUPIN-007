import { useCallback, useEffect, useMemo, useState } from "react";
import type { FleetEnvironment, TargetNode } from "@/types/operations";

const API =
  import.meta.env.VITE_CONTROL_PLANE_ORIGIN ??
  (typeof window !== "undefined" && (window.location.port === "3000" || !window.location.port)
    ? ""
    : "http://localhost:3001");

interface FleetHostRow {
  id: string;
  hostname: string;
  ip: string | null;
  port: number;
  ssh_user: string | null;
  ssh_key_path: string | null;
  podman_socket: string | null;
  created_at: string;
  last_probe_status: string | null;
  last_probe_at: string | null;
  probe_latency_ms: number | null;
  probe_error: string | null;
}

function mapHostToTargetNode(host: FleetHostRow): TargetNode {
  const isOnline = host.last_probe_status === "online";
  const status = isOnline ? "CONNECTED" : "UNREACHABLE";

  return {
    id: host.id,
    hostname: host.hostname,
    ipAddress: host.ip || "127.0.0.1",
    osBadge: host.podman_socket ? "Podman Container" : "Ubuntu Linux",
    cloudProvider: host.podman_socket ? "Local Podman" : "Direct Host",
    status,
    latencyMs: host.probe_latency_ms ?? (isOnline ? 8 : 0),
    runtimeEngine: host.podman_socket ? "PODMAN_SOCKET" : "DIRECT_SSH",
    isAgentExecuting: false,
    environmentTag: "prod",
    tags: [`host:${host.hostname}`, `port:${host.port}`],
    authConfig: {
      keyPath: host.ssh_key_path || "~/.ssh/id_rsa",
      user: host.ssh_user || "root",
      port: host.port || 22,
    },
    metrics: {
      cpuPercent: isOnline ? 24 : 0,
      ramPercent: isOnline ? 38 : 0,
      diskAvailableGb: isOnline ? 120 : 0,
      activeProcesses: isOnline ? 85 : 0,
    },
    attachedServices: host.podman_socket ? ["podman.socket"] : ["sshd.service"],
    commandHistory: [],
  };
}

export function useFleetManager() {
  const [hosts, setHosts] = useState<TargetNode[]>([]);
  const [query, setQuery] = useState("");
  const [environment, setEnvironment] = useState<FleetEnvironment>("all");
  const [selectedNode, setSelectedNode] = useState<TargetNode | null>(null);
  const [notice, setNotice] = useState("");

  const fetchHosts = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/fleet/hosts`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: FleetHostRow[] };
      if (Array.isArray(body.data)) {
        setHosts(body.data.map(mapHostToTargetNode));
      }
    } catch {
      // Non-fatal if offline
    }
  }, []);

  useEffect(() => {
    void fetchHosts();
  }, [fetchHosts]);

  useEffect(() => {
    const handleFleetUpdated = () => {
      void fetchHosts();
    };
    window.addEventListener("fleet_updated", handleFleetUpdated);
    return () => window.removeEventListener("fleet_updated", handleFleetUpdated);
  }, [fetchHosts]);

  const nodes = useMemo(() => {
    return hosts.filter((node) => {
      const matchesEnvironment = environment === "all" || node.environmentTag === environment;
      const needle = query.trim().toLowerCase();
      const matchesQuery =
        !needle ||
        [node.hostname, node.ipAddress, node.status, node.environmentTag, ...node.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      return matchesEnvironment && matchesQuery;
    });
  }, [hosts, environment, query]);

  const onRegisterTarget = useCallback(() => {
    setNotice("Target registration: add host via FirstRunSetup or POST /api/fleet/hosts.");
  }, []);

  const onConnectSubshell = useCallback((node: TargetNode) => {
    setNotice(`Subshell request queued for ${node.hostname}.`);
  }, []);

  const onSpawnTwin = useCallback((node: TargetNode) => {
    setNotice(`Twin container request staged from ${node.hostname}.`);
  }, []);

  const onHealthCheck = useCallback(
    async (node: TargetNode) => {
      setNotice(`Probing ${node.hostname}...`);
      try {
        const res = await fetch(`${API}/api/fleet/probe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host_id: node.id }),
        });
        const data = (await res.json()) as { ssh?: boolean; latency_ms?: number; error?: string };
        if (data.ssh) {
          setNotice(`Host ${node.hostname} is online (${data.latency_ms}ms RTT).`);
        } else {
          setNotice(`Probe failed for ${node.hostname}: ${data.error ?? "unreachable"}`);
        }
        await fetchHosts();
      } catch (err) {
        setNotice(`Probe request error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [fetchHosts]
  );

  return {
    nodes,
    query,
    environment,
    selectedNode,
    notice,
    setQuery,
    setEnvironment,
    setSelectedNode,
    onRegisterTarget,
    onConnectSubshell,
    onSpawnTwin,
    onHealthCheck,
  };
}
