import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import type { SandboxRunner, SandboxProbeResult, SandboxExecResult } from "./types";

/**
 * Sensitive environment variable prefixes and names to scrub from isolated sandbox processes.
 */
const SCRUBBED_ENV_PATTERNS = [
  /_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /_PASSWORD$/i,
  /^AWS_/i,
  /^GCP_/i,
  /^AZURE_/i,
  /^TRUEFORGE_/i,
  /^OPENAI_/i,
  /^ANTHROPIC_/i,
  /^GEMINI_/i,
];

export class IsolatedProcessRunner implements SandboxRunner {
  readonly type = "isolated-local" as const;

  async probe(): Promise<SandboxProbeResult> {
    const tmpDir = os.tmpdir();
    const isWritable = fs.existsSync(tmpDir);
    return {
      available: isWritable,
      type: this.type,
      latencyMs: 1,
      details: "Simulated host process isolation in /tmp scratch directory with scrubbed environment",
    };
  }

  async createSession(sessionId: string, _env?: Record<string, string>): Promise<{ sandboxId: string }> {
    const sandboxDir = path.join(os.tmpdir(), `lupin-sandbox-${sessionId}`);
    if (!fs.existsSync(sandboxDir)) {
      fs.mkdirSync(sandboxDir, { recursive: true, mode: 0o700 });
    }
    return { sandboxId: sessionId };
  }

  async exec(sandboxId: string, command: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<SandboxExecResult> {
    const sandboxDir = opts?.cwd || path.join(os.tmpdir(), `lupin-sandbox-${sandboxId}`);
    if (!fs.existsSync(sandboxDir)) {
      fs.mkdirSync(sandboxDir, { recursive: true, mode: 0o700 });
    }

    const cleanEnv: Record<string, string> = {
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
      HOME: sandboxDir,
      TMPDIR: sandboxDir,
      USER: process.env.USER || "sandbox",
      LANG: process.env.LANG || "en_US.UTF-8",
    };

    // Copy non-sensitive variables
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      const isSensitive = SCRUBBED_ENV_PATTERNS.some((p) => p.test(k));
      if (!isSensitive && !cleanEnv[k]) {
        cleanEnv[k] = v;
      }
    }

    const timeoutMs = opts?.timeoutMs || 30000;
    const t0 = Date.now();

    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd: sandboxDir,
          env: cleanEnv,
          timeout: timeoutMs,
          maxBuffer: 5 * 1024 * 1024, // 5MB
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - t0;
          const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
          resolve({
            exitCode,
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            durationMs,
          });
        }
      );
    });
  }

  async destroySession(sandboxId: string): Promise<void> {
    const sandboxDir = path.join(os.tmpdir(), `lupin-sandbox-${sandboxId}`);
    try {
      if (fs.existsSync(sandboxDir)) {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup
    }
  }
}
