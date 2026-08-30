import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SandboxRunner, SandboxProbeResult, SandboxExecResult, SandboxType } from "./types";
import { probeUnixSocket, probeCliBinary } from "./socket-probe";

const execFileAsync = promisify(execFile);

abstract class BaseContainerRunner implements SandboxRunner {
  abstract readonly type: SandboxType;
  abstract readonly binaryName: string;
  abstract readonly defaultSocketPaths: string[];
  abstract readonly defaultImage: string;

  protected sessionContainers = new Map<string, string>(); // sessionId -> containerName/ID
  protected activeSocketPath?: string;

  protected getEnv(customSocket?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const socket = customSocket || this.activeSocketPath;
    if (socket) {
      if (this.type === "podman") {
        env.CONTAINER_HOST = socket.startsWith("unix://") ? socket : `unix://${socket}`;
      } else if (this.type === "docker") {
        env.DOCKER_HOST = socket.startsWith("unix://") ? socket : `unix://${socket}`;
      }
    }
    return env;
  }

  async probe(config?: { socketPath?: string }): Promise<SandboxProbeResult> {
    const candidateSockets = config?.socketPath ? [config.socketPath] : this.defaultSocketPaths;

    let socketResult: { ok: boolean; latencyMs: number; error?: string } = { ok: false, latencyMs: 0 };
    let foundSocket: string | undefined;

    for (const socket of candidateSockets) {
      const probe = await probeUnixSocket(socket);
      if (probe.ok) {
        socketResult = probe;
        foundSocket = socket;
        this.activeSocketPath = socket;
        break;
      }
    }

    if (socketResult.ok && foundSocket) {
      return {
        available: true,
        type: this.type,
        socketPath: foundSocket,
        latencyMs: socketResult.latencyMs,
        details: `Active socket at ${foundSocket} (${socketResult.latencyMs}ms)`,
      };
    }

    // Fallback: Check CLI binary
    const cliProbe = await probeCliBinary(this.binaryName);
    if (cliProbe.ok) {
      return {
        available: true,
        type: this.type,
        details: `CLI binary detected: ${cliProbe.version}`,
      };
    }

    return {
      available: false,
      type: this.type,
      error: socketResult.error || cliProbe.error || `Socket and CLI binary not found`,
    };
  }

  async createSession(sessionId: string, _env?: Record<string, string>): Promise<{ sandboxId: string }> {
    const containerName = `lupin-${this.type}-${sessionId.slice(0, 12)}`;
    const workspaceDir = path.join(os.tmpdir(), `lupin-sandbox-${sessionId}`);
    if (!fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
    }

    // Start an ephemeral container in detached mode that sleeps
    await execFileAsync(
      this.binaryName,
      [
        "run",
        "-d",
        "--name",
        containerName,
        "--rm",
        "-v",
        `${workspaceDir}:/workspace:rw`,
        "-w",
        "/workspace",
        this.defaultImage,
        "sleep",
        "3600",
      ],
      { timeout: 15000, env: this.getEnv() }
    );

    this.sessionContainers.set(sessionId, containerName);
    return { sandboxId: sessionId };
  }

  async exec(sandboxId: string, command: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<SandboxExecResult> {
    const containerName = this.sessionContainers.get(sandboxId) || `lupin-${this.type}-${sandboxId.slice(0, 12)}`;
    const timeoutMs = opts?.timeoutMs || 30000;
    const t0 = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync(
        this.binaryName,
        ["exec", containerName, "sh", "-c", command],
        { timeout: timeoutMs, env: this.getEnv() }
      );
      return {
        exitCode: 0,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        durationMs: Date.now() - t0,
      };
    } catch (err: unknown) {
      const e = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
      const exitCode = typeof e.code === "number" ? e.code : 1;
      return {
        exitCode,
        stdout: e.stdout?.toString() || "",
        stderr: e.stderr?.toString() || e.message || String(err),
        durationMs: Date.now() - t0,
      };
    }
  }

  async destroySession(sandboxId: string): Promise<void> {
    const containerName = this.sessionContainers.get(sandboxId);
    if (containerName) {
      try {
        await execFileAsync(this.binaryName, ["kill", containerName], { timeout: 5000, env: this.getEnv() });
      } catch {
        // Best effort
      }
      this.sessionContainers.delete(sandboxId);
    }
    const workspaceDir = path.join(os.tmpdir(), `lupin-sandbox-${sandboxId}`);
    try {
      if (fs.existsSync(workspaceDir)) {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    } catch {
      // Best effort
    }
  }
}

export class PodmanRunner extends BaseContainerRunner {
  readonly type = "podman" as const;
  readonly binaryName = "podman";
  readonly defaultImage = "alpine:latest";
  readonly defaultSocketPaths = [
    `/run/user/${process.getuid ? process.getuid() : 1000}/podman/podman.sock`,
    "/run/podman/podman.sock",
    "/tmp/podman.sock",
  ];
}

export class DockerRunner extends BaseContainerRunner {
  readonly type = "docker" as const;
  readonly binaryName = "docker";
  readonly defaultImage = "alpine:latest";
  readonly defaultSocketPaths = [
    "/var/run/docker.sock",
    `/run/user/${process.getuid ? process.getuid() : 1000}/docker.sock`,
    "/tmp/docker.sock",
  ];
}
