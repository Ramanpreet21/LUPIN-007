import { execFile } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import path from "node:path";
import { getDb } from "../db";
import { probeCliBinary, probeUnixSocket } from "../sandboxes/socket-probe";

const execFileAsync = promisify(execFile);

export interface ComposeEngine {
  binary: string;
  composeArgs: string[];
  type: "docker" | "podman";
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
      return { binary: "podman", composeArgs: ["compose"], type: "podman" };
    }
  }

  // Check Docker
  const dockerCli = await probeCliBinary("docker");
  if (dockerCli.ok) {
    return { binary: "docker", composeArgs: ["compose"], type: "docker" };
  }

  // Fallback: Check podman CLI
  const podmanFallback = await probeCliBinary("podman");
  if (podmanFallback.ok) {
    return { binary: "podman", composeArgs: ["compose"], type: "podman" };
  }

  // Fallback: Check podman-compose or docker-compose
  const podmanCompose = await probeCliBinary("podman-compose");
  if (podmanCompose.ok) {
    return { binary: "podman-compose", composeArgs: [], type: "podman" };
  }

  const dockerCompose = await probeCliBinary("docker-compose");
  if (dockerCompose.ok) {
    return { binary: "docker-compose", composeArgs: [], type: "docker" };
  }

  return { binary: "docker", composeArgs: ["compose"], type: "docker" };
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

export async function startDemoStack(
  broadcast?: (event: { type: string; payload: unknown }) => void,
  workspaceRoot = process.cwd()
): Promise<{ ok: boolean; engine: string; sshReady: boolean; error?: string }> {
  const engine = await detectComposeEngine();
  const composeFile = path.join(workspaceRoot, "docker-compose.yml");

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

  // Wait for SSH port 2222 on tf-server
  const sshReady = await waitForPort("127.0.0.1", 2222, 10000);

  // Auto-register cluster fleet hosts into SQLite database
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

    const now = new Date().toISOString();

    insertHost.run({
      id: "node-server",
      hostname: "localhost",
      ip: "127.0.0.1",
      port: 2222,
      ssh_user: "root",
      last_probe_status: "online",
      os_info: "Alpine Linux (Gateway / Server)",
      created_at: now,
    });

    insertHost.run({
      id: "node-client1",
      hostname: "client1",
      ip: "client1",
      port: 22,
      ssh_user: "root",
      last_probe_status: "online",
      os_info: "Alpine Linux (Database / Redis)",
      created_at: now,
    });

    insertHost.run({
      id: "node-client2",
      hostname: "client2",
      ip: "client2",
      port: 22,
      ssh_user: "root",
      last_probe_status: "online",
      os_info: "Alpine Linux (Web / Apache / PHP)",
      created_at: now,
    });

    insertHost.run({
      id: "node-client3",
      hostname: "client3",
      ip: "client3",
      port: 22,
      ssh_user: "root",
      last_probe_status: "online",
      os_info: "Alpine Linux (App / Python / Node)",
      created_at: now,
    });

    insertHost.run({
      id: "node-attacker",
      hostname: "attacker",
      ip: "attacker",
      port: 22,
      ssh_user: "root",
      last_probe_status: "online",
      os_info: "Alpine Linux (Security Auditor)",
      created_at: now,
    });

    // Auto-configure sandbox provider in SQLite settings
    const upsertSetting = db.prepare(`
      INSERT INTO settings (key, value) VALUES (@key, @value)
      ON CONFLICT(key) DO UPDATE SET value = @value
    `);
    upsertSetting.run({ key: "sandbox_provider", value: engine.type });
    upsertSetting.run({ key: "launch_mode", value: "DEMO_MOCK" });

    broadcast?.({
      type: "fleet_updated",
      payload: { count: 5, source: "demo_compose" },
    });

    broadcast?.({
      type: "sandbox_provider_changed",
      payload: { provider: engine.type },
    });
  } catch (err) {
    // Database registration error
    console.error("Failed to auto-register fleet hosts:", err);
  }

  return {
    ok: true,
    engine: engine.type,
    sshReady,
  };
}

export async function stopDemoStack(workspaceRoot = process.cwd()): Promise<{ ok: boolean; error?: string }> {
  const engine = await detectComposeEngine();
  const composeFile = path.join(workspaceRoot, "docker-compose.yml");

  try {
    const args = [...engine.composeArgs, "-f", composeFile, "down"];
    await execFileAsync(engine.binary, args, { timeout: 30000 });
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
  const composeFile = path.join(workspaceRoot, "docker-compose.yml");

  try {
    const args = [...engine.composeArgs, "-f", composeFile, "ps", "--format", "json"];
    const { stdout } = await execFileAsync(engine.binary, args, { timeout: 10000 });
    const output = stdout.trim();
    const running = output.includes("tf-server") || output.includes("server") || output.length > 5;
    const sshReady = await waitForPort("127.0.0.1", 2222, 1000);
    const alertmanagerReady = await waitForPort("127.0.0.1", 9093, 1000);

    return {
      running,
      engine: engine.type,
      sshReady,
      alertmanagerReady,
      nodes: ["tf-server", "tf-client1", "tf-client2", "tf-client3", "tf-attacker", "tf-alertmanager", "tf-prometheus"],
    };
  } catch {
    const sshReady = await waitForPort("127.0.0.1", 2222, 500);
    return {
      running: sshReady,
      engine: engine.type,
      sshReady,
      alertmanagerReady: false,
      nodes: [],
    };
  }
}

export async function triggerDemoPrometheusAlert(
  controlPlanePort = 3001,
  alertOverride?: { alertname?: string; severity?: string; summary?: string; description?: string }
): Promise<{ ok: boolean; incidentId?: string; error?: string }> {
  const alertPayload = {
    version: "4",
    groupKey: `{}:{alertname="${alertOverride?.alertname || "HighCPUUsage"}"}`,
    status: "firing",
    receiver: "webhook",
    alerts: [
      {
        status: "firing",
        labels: {
          alertname: alertOverride?.alertname || "HighCPUUsage",
          severity: alertOverride?.severity || "critical",
          instance: "tf-server:2222",
          job: "node_exporter",
          component: "system",
          host: "localhost",
        },
        annotations: {
          summary: alertOverride?.summary || "CPU usage exceeds 92% on tf-server gateway",
          description:
            alertOverride?.description ||
            "Rogue runaway process PID 4192 consuming 98.4% CPU cycles on primary server. Remediation requires process inspection and service restart.",
        },
        startsAt: new Date().toISOString(),
        endsAt: "0001-01-01T00:00:00Z",
        generatorURL: "http://localhost:9090/graph",
        fingerprint: "demo-cpu-alert-007",
      },
    ],
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
      return { ok: true, incidentId };
    }

    return { ok: false, error: `Control plane returned HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
