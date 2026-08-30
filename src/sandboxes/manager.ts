import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { getDaytonaApiKey } from "../sandbox-settings";
import type { SandboxRunner, SandboxProbeResult, SandboxType, SandboxExecResult } from "./types";
import { IsolatedProcessRunner } from "./isolated-process-runner";
import { PodmanRunner, DockerRunner } from "./container-runners";
import { DaytonaRunner } from "./daytona-runner";

export class SandboxManager {
  private runners = new Map<SandboxType, SandboxRunner>();

  constructor() {
    this.registerRunner(new IsolatedProcessRunner());
    this.registerRunner(new PodmanRunner());
    this.registerRunner(new DockerRunner());
    this.registerRunner(new DaytonaRunner("daytona"));
    this.registerRunner(new DaytonaRunner("daytona-custom"));
  }

  registerRunner(runner: SandboxRunner) {
    this.runners.set(runner.type, runner);
  }

  getRunner(type: SandboxType): SandboxRunner {
    const runner = this.runners.get(type);
    if (!runner) {
      // Default fallback
      return this.runners.get("isolated-local")!;
    }
    return runner;
  }

  getActiveType(): SandboxType {
    try {
      const db = getDb();
      const row = db.prepare("SELECT value FROM settings WHERE key = 'sandbox_provider'").get() as { value?: string } | undefined;
      if (row?.value && this.runners.has(row.value as SandboxType)) {
        return row.value as SandboxType;
      }
    } catch {
      // Fallback
    }
    return "isolated-local";
  }

  getActiveRunner(): SandboxRunner {
    return this.getRunner(this.getActiveType());
  }

  async probeAll(): Promise<{ activeProvider: SandboxType; probes: SandboxProbeResult[] }> {
    const activeProvider = this.getActiveType();
    let dbSettings: Record<string, string> = {};
    try {
      const db = getDb();
      const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
      for (const r of rows) dbSettings[r.key] = r.value;
    } catch {
      // Fallback
    }

    const probes: SandboxProbeResult[] = [];

    for (const [type, runner] of this.runners.entries()) {
      let config: { socketPath?: string; serverUrl?: string; apiKey?: string } | undefined;
      if (type === "daytona" || type === "daytona-custom") {
        config = {
          apiKey: getDaytonaApiKey(),
          serverUrl: dbSettings.sandbox_url,
        };
      } else if (type === "podman" || type === "docker") {
        config = {
          socketPath: dbSettings.sandbox_url,
        };
      }

      const res = await runner.probe(config);
      probes.push(res);
    }

    return { activeProvider, probes };
  }

  async execInActive(command: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<SandboxExecResult> {
    const runner = this.getActiveRunner();
    const sessionId = `test-${Date.now()}-${randomUUID()}`;
    try {
      await runner.createSession(sessionId);
      return await runner.exec(sessionId, command, opts);
    } finally {
      await runner.destroySession(sessionId);
    }
  }
}

let globalManager: SandboxManager | null = null;

export function getSandboxManager(): SandboxManager {
  if (!globalManager) {
    globalManager = new SandboxManager();
  }
  return globalManager;
}
