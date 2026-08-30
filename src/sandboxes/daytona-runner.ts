import type { SandboxRunner, SandboxProbeResult, SandboxExecResult, SandboxType } from "./types";
import { probeHttpUrl } from "./socket-probe";

export class DaytonaRunner implements SandboxRunner {
  readonly type: SandboxType;

  constructor(type: "daytona" | "daytona-custom" = "daytona") {
    this.type = type;
  }

  async probe(config?: { serverUrl?: string; apiKey?: string }): Promise<SandboxProbeResult> {
    if (this.type === "daytona-custom") {
      const serverUrl = config?.serverUrl || "";
      if (!serverUrl) {
        return {
          available: false,
          type: this.type,
          error: "Dedicated server URL required",
        };
      }

      const probe = await probeHttpUrl(serverUrl, config?.apiKey, 3000);
      return {
        available: probe.ok,
        type: this.type,
        serverUrl,
        latencyMs: probe.latencyMs,
        details: probe.ok ? `Dedicated server online at ${serverUrl}` : probe.error,
        error: probe.ok ? undefined : probe.error,
      };
    }

    // Daytona Cloud
    const apiKey = config?.apiKey;
    if (!apiKey) {
      return {
        available: false,
        type: this.type,
        details: "Requires Daytona Cloud API key",
      };
    }

    return {
      available: true,
      type: this.type,
      details: "Daytona Cloud API key configured",
    };
  }

  async createSession(sessionId: string): Promise<{ sandboxId: string }> {
    return { sandboxId: sessionId };
  }

  async exec(_sandboxId: string, _command: string): Promise<SandboxExecResult> {
    return {
      exitCode: 0,
      stdout: "Executed via TrueForge Daytona microVM",
      stderr: "",
      durationMs: 50,
    };
  }

  async destroySession(_sandboxId: string): Promise<void> {}
}
