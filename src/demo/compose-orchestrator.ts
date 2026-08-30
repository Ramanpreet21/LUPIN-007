import { execFile } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "../db";
import { probeCliBinary, probeUnixSocket } from "../sandboxes/socket-probe";

const execFileAsync = promisify(execFile);

export interface ComposeEngine {
  binary: string;
  composeArgs: string[];
  type: "docker" | "podman" | "none";
  available?: boolean;
}

export interface DemoStatusResult {
  running: boolean;
  engine: "docker" | "podman" | "none";
  sshReady: boolean;
  alertmanagerReady: boolean;
  nodes: string[];
  error?: string;
}

export async function detectComposeEngine(): Promise<ComposeEngine> {
  // Check Podman socket and binary first if user has active podman
  const podmanSocket = await probeUnixSocket(`/run/user/${process.getuid ? process.getuid() : 1000}/podman/podman.sock`);
  if (podmanSocket.ok) {
    const podmanCli = await probeCliBinary("podman");
    if (podmanCli.ok) {
      return { binary: "podman", composeArgs: ["compose"], type: "podman", available: true };
    }
  }

  // Check Docker
  const dockerCli = await probeCliBinary("docker");
  if (dockerCli.ok) {
    return { binary: "docker", composeArgs: ["compose"], type: "docker", available: true };
  }

  // Fallback: Check podman CLI
  const podmanFallback = await probeCliBinary("podman");
  if (podmanFallback.ok) {
    return { binary: "podman", composeArgs: ["compose"], type: "podman", available: true };
  }

  // Fallback: Check podman-compose or docker-compose
  const podmanCompose = await probeCliBinary("podman-compose");
  if (podmanCompose.ok) {
    return { binary: "podman-compose", composeArgs: [], type: "podman", available: true };
  }

  const dockerCompose = await probeCliBinary("docker-compose");
  if (dockerCompose.ok) {
    return { binary: "docker-compose", composeArgs: [], type: "docker", available: true };
  }

  return { binary: "", composeArgs: [], type: "none", available: false };
}

async function waitForPort(host: string, port: number, timeoutMs = 10000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(800);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });

    if (reachable) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export function resolveComposeFilePath(workspaceRoot = process.cwd()): string {
  const candidates = [
    path.join(workspaceRoot, "docker-compose.yml"),
    path.resolve(workspaceRoot, "docker-compose.yml"),
    path.resolve(__dirname, "../../docker-compose.yml"),
    path.resolve(__dirname, "../../../docker-compose.yml"),
    path.resolve(process.cwd(), "docker-compose.yml"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(workspaceRoot, "docker-compose.yml");
}

export async function startDemoStack(
  broadcast?: (event: { type: string; payload: unknown }) => void,
  workspaceRoot = process.cwd()
): Promise<{ ok: boolean; engine: string; sshReady: boolean; error?: string }> {
  const engine = await detectComposeEngine();
  if (engine.type === "none" || !engine.binary) {
    return {
      ok: false,
      engine: "none",
      sshReady: false,
      error: "No container engine detected. Please install Docker or Podman.",
    };
  }

  const composeFile = resolveComposeFilePath(workspaceRoot);

  try {
    const args = [...engine.composeArgs, "-f", composeFile, "up", "-d"];
    await execFileAsync(engine.binary, args, { timeout: 60000 });
  } catch (err) {
    return {
      ok: false,
      engine: engine.type,
      sshReady: false,
      error: `Failed to launch ${engine.binary} compose: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Poll for SSH port 2222 on tf-server with retries up to 15 seconds
  let sshReady = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    sshReady = await waitForPort("127.0.0.1", 2222, 1000);
    if (sshReady) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!sshReady) {
    return {
      ok: false,
      engine: engine.type,
      sshReady: false,
      error: "SSH gateway port 2222 did not become ready within 15 seconds",
    };
  }

  // Auto-register cluster fleet hosts into SQLite database transactionally
  try {
    const db = getDb();
    const insertHost = db.prepare(`
      INSERT INTO fleet_hosts (id, hostname, ip, port, ssh_user, last_probe_status, os_info, created_at)
      VALUES (@id, @hostname, @ip, @port, @ssh_user, @last_probe_status, @os_info, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        hostname = @hostname,
        ip = @ip,
        port = @port,
        ssh_user = @ssh_user,
        last_probe_status = @last_probe_status,
        os_info = @os_info
    `);

    const upsertSetting = db.prepare(`
      INSERT INTO settings (key, value) VALUES (@key, @value)
      ON CONFLICT(key) DO UPDATE SET value = @value
    `);

    const registerClusterTx = db.transaction(() => {
      const now = new Date().toISOString();

      const hosts = [
        {
          id: "node-server",
          hostname: "localhost",
          ip: "127.0.0.1",
          port: 2222,
          ssh_user: "root",
          last_probe_status: "online",
          os_info: "Alpine Linux (Gateway / Server)",
          created_at: now,
        },
        {
          id: "node-client1",
          hostname: "client1",
          ip: "127.0.0.1",
          port: 2223,
          ssh_user: "root",
          last_probe_status: "online",
          os_info: "Alpine Linux (Database / Redis)",
          created_at: now,
        },
        {
          id: "node-client2",
          hostname: "client2",
          ip: "127.0.0.1",
          port: 2224,
          ssh_user: "root",
          last_probe_status: "online",
          os_info: "Alpine Linux (Web / Apache / PHP)",
          created_at: now,
        },
        {
          id: "node-client3",
          hostname: "client3",
          ip: "127.0.0.1",
          port: 2225,
          ssh_user: "root",
          last_probe_status: "online",
          os_info: "Alpine Linux (App / Python / Node)",
          created_at: now,
        },
        {
          id: "node-attacker",
          hostname: "attacker",
          ip: "127.0.0.1",
          port: 2226,
          ssh_user: "root",
          last_probe_status: "online",
          os_info: "Alpine Linux (Security Auditor)",
          created_at: now,
        },
      ];

      for (const h of hosts) {
        insertHost.run(h);
      }

      upsertSetting.run({ key: "sandbox_provider", value: engine.type });
      upsertSetting.run({ key: "launch_mode", value: "DEMO_MOCK" });
    });

    registerClusterTx();

    broadcast?.({
      type: "fleet_updated",
      payload: { count: 5 },
    });

    broadcast?.({
      type: "sandbox_provider_changed",
      payload: { provider: engine.type },
    });
  } catch (err) {
    return {
      ok: false,
      engine: engine.type,
      sshReady: true,
      error: `Failed to auto-register fleet hosts in database: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    ok: true,
    engine: engine.type,
    sshReady: true,
  };
}

export const DEMO_NODE_IDS = [
  "node-server",
  "node-client1",
  "node-client2",
  "node-client3",
  "node-attacker",
];

export async function stopDemoStack(
  broadcastOrWorkspace?: ((event: { type: string; payload: unknown }) => void) | string,
  workspaceParam = process.cwd()
): Promise<{ ok: boolean; error?: string }> {
  const broadcast = typeof broadcastOrWorkspace === "function" ? broadcastOrWorkspace : undefined;
  const workspaceRoot = typeof broadcastOrWorkspace === "string" ? broadcastOrWorkspace : workspaceParam;
  const engine = await detectComposeEngine();
  if (engine.type === "none" || !engine.binary) {
    return {
      ok: false,
      error: "No container engine detected. Cannot stop compose stack.",
    };
  }

  const composeFile = resolveComposeFilePath(workspaceRoot);

  try {
    const args = [...engine.composeArgs, "-f", composeFile, "down"];
    await execFileAsync(engine.binary, args, { timeout: 30000 });

    try {
      const db = getDb();
      const deleteHost = db.prepare("DELETE FROM fleet_hosts WHERE id = ?");
      for (const id of DEMO_NODE_IDS) {
        deleteHost.run(id);
      }

      const upsertSetting = db.prepare(`
        INSERT INTO settings (key, value) VALUES (@key, @value)
        ON CONFLICT(key) DO UPDATE SET value = @value
      `);
      upsertSetting.run({ key: "sandbox_provider", value: "isolated-local" });
      upsertSetting.run({ key: "launch_mode", value: "LIVE_HOST" });

      const remainingHosts = (db.prepare("SELECT count(*) as count FROM fleet_hosts").get() as { count: number })?.count ?? 0;

      broadcast?.({
        type: "fleet_updated",
        payload: { count: remainingHosts },
      });

      broadcast?.({
        type: "sandbox_provider_changed",
        payload: { provider: "isolated-local" },
      });
    } catch (err) {
      console.error("Failed to clean up demo database records:", err);
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to stop compose stack: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function getDemoStatus(workspaceRoot = process.cwd()): Promise<DemoStatusResult> {
  const engine = await detectComposeEngine();
  if (engine.type === "none" || !engine.binary) {
    const sshReady = await waitForPort("127.0.0.1", 2222, 500);
    return {
      running: false,
      engine: "none",
      sshReady,
      alertmanagerReady: false,
      nodes: [],
      error: "No container engine detected",
    };
  }

  const composeFile = resolveComposeFilePath(workspaceRoot);

  try {
    const args = [...engine.composeArgs, "-f", composeFile, "ps", "--format", "json"];
    const { stdout } = await execFileAsync(engine.binary, args, { timeout: 10000 });
    const output = stdout.trim();
    
    let runningNodes: string[] = [];
    if (output) {
      try {
        const parsed = output.startsWith("[")
          ? JSON.parse(output)
          : output.split("\n").filter(Boolean).map((line) => JSON.parse(line));
        if (Array.isArray(parsed)) {
          runningNodes = parsed
            .filter((item: { State?: string; Status?: string }) => {
              const state = (item.State || item.Status || "").toLowerCase();
              return state.includes("running") || state.includes("up");
            })
            .map((item: { Service?: string; Name?: string }) => item.Service || item.Name || "")
            .filter(Boolean);
        }
      } catch {
        if (output.includes("tf-server") || output.includes("server")) {
          runningNodes = ["tf-server"];
        }
      }
    }

    const sshReady = await waitForPort("127.0.0.1", 2222, 1000);
    const alertmanagerReady = await waitForPort("127.0.0.1", 9093, 1000);
    const running = runningNodes.length > 0 && sshReady;

    return {
      running,
      engine: engine.type,
      sshReady,
      alertmanagerReady,
      nodes: runningNodes,
    };
  } catch {
    const sshReady = await waitForPort("127.0.0.1", 2222, 500);
    return {
      running: false,
      engine: engine.type,
      sshReady,
      alertmanagerReady: false,
      nodes: [],
    };
  }
}

export const DEMO_ALERT_PRESETS = [
  {
    alertname: "HighCPUUsage",
    severity: "critical",
    instance: "tf-server:2222",
    host: "localhost",
    job: "node_exporter",
    summary: "High CPU usage detected on tf-server gateway",
    description: "Instance localhost:2222 CPU usage is 94.2% across cores.",
  },
  {
    alertname: "DiskSpaceCritical",
    severity: "critical",
    instance: "client1:22",
    host: "client1",
    job: "node_exporter",
    summary: "Disk space critical on Redis / Database node",
    description: "Disk usage on client1 is 96.8% (less than 10% remaining in /tmp).",
  },
  {
    alertname: "NginxDown",
    severity: "critical",
    instance: "client2:22",
    host: "client2",
    job: "nginx",
    summary: "Nginx web server is down",
    description: "Nginx on client2 is not responding on port 80.",
  },
  {
    alertname: "MySQLDown",
    severity: "critical",
    instance: "client2:22",
    host: "client2",
    job: "mysqld",
    summary: "MySQL database engine is down",
    description: "MySQL daemon on client2 is not responding to health probes.",
  },
  {
    alertname: "RedisDown",
    severity: "warning",
    instance: "client1:22",
    host: "client1",
    job: "redis",
    summary: "Redis cache service is down",
    description: "Redis instance on client1 stopped unexpectedly.",
  },
  {
    alertname: "HighMemoryUsage",
    severity: "warning",
    instance: "client3:22",
    host: "client3",
    job: "node_exporter",
    summary: "Memory pressure detected on API backend",
    description: "Available memory on client3 is under 15% (OOM killer imminent).",
  },
  {
    alertname: "LoadAverageHigh",
    severity: "warning",
    instance: "client3:22",
    host: "client3",
    job: "node_exporter",
    summary: "High system load on API backend",
    description: "Load average on client3 is 7.42 (exceeds threshold 4.0).",
  },
  {
    alertname: "SSLCertExpiring",
    severity: "warning",
    instance: "tf-server:2222",
    host: "localhost",
    job: "blackbox-http",
    summary: "SSL certificate expiring soon",
    description: "TLS certificate for api.internal expires in 48 hours.",
  },
];

export async function triggerDemoPrometheusAlert(
  controlPlanePort = 3001,
  alertOverride?: { alertname?: string; severity?: string; summary?: string; description?: string }
): Promise<{ ok: boolean; count?: number; incidentId?: string; error?: string }> {
  const selectedName = alertOverride?.alertname || "HighCPUUsage";

  let itemsToFire: Array<{
    alertname: string;
    severity: string;
    instance: string;
    host: string;
    job: string;
    summary: string;
    description: string;
  }> = [];

  if (selectedName === "all") {
    itemsToFire = DEMO_ALERT_PRESETS.map((p) => ({
      ...p,
      ...(alertOverride?.severity ? { severity: alertOverride.severity } : {}),
      ...(alertOverride?.summary ? { summary: alertOverride.summary } : {}),
      ...(alertOverride?.description ? { description: alertOverride.description } : {}),
    }));
  } else {
    const matchedPresets = DEMO_ALERT_PRESETS.filter(
      (p) => p.alertname.toLowerCase() === selectedName.toLowerCase()
    );

    if (matchedPresets.length > 0) {
      itemsToFire = matchedPresets.map((preset) => ({
        ...preset,
        ...(alertOverride?.severity ? { severity: alertOverride.severity } : {}),
        ...(alertOverride?.summary ? { summary: alertOverride.summary } : {}),
        ...(alertOverride?.description ? { description: alertOverride.description } : {}),
      }));
    } else {
      itemsToFire = [
        {
          alertname: selectedName,
          severity: alertOverride?.severity || "critical",
          instance: "tf-server:2222",
          host: "localhost",
          job: "system",
          summary: alertOverride?.summary || `${selectedName} detected on target host`,
          description: alertOverride?.description || `Alert ${selectedName} triggered for demo verification.`,
        },
      ];
    }
  }

  const alertPayload = {
    version: "4",
    groupKey: `{}:{alertname="${selectedName}"}`,
    status: "firing",
    receiver: "webhook",
    alerts: itemsToFire.map((item) => ({
      status: "firing",
      labels: {
        alertname: item.alertname,
        severity: item.severity,
        instance: item.instance,
        job: item.job,
        component: item.job,
        host: item.host,
      },
      annotations: {
        summary: item.summary,
        description: item.description,
      },
      startsAt: new Date().toISOString(),
      endsAt: "0001-01-01T00:00:00Z",
      generatorURL: "http://localhost:9090/graph",
      fingerprint: `demo-alert-${item.alertname.toLowerCase()}`,
    })),
  };

  try {
    const res = await fetch(`http://localhost:${controlPlanePort}/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alertPayload),
    });

    if (res.ok) {
      const data = (await res.json()) as { incidentId?: string; id?: string; incidents?: Array<{ id: string }> };
      const incidentId = data.incidentId || data.id || data.incidents?.[0]?.id;
      return { ok: true, count: itemsToFire.length, incidentId };
    }

    return { ok: false, error: `Control plane returned HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
