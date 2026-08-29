import { spawn } from "node:child_process";

export interface ExecOptions {
  /** Kill the child and fail if it doesn't exit within this window. */
  timeoutMs?: number;
  /** Ceiling on accumulated stdout+stderr; exceeding this fails the call. */
  maxBufferBytes?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Non-zero exit — carries the captured output so callers can render stderr. */
export class ExecError extends Error {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, exitCode: number, stdout: string, stderr: string) {
    super(message);
    this.name = "ExecError";
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * The single command-execution primitive for the local MCP tool provider (5b)
 * and system-state capture (5c). Runs a binary with an arg array — no shell,
 * no interpolation, nothing but the allowlisted read-only commands the caller
 * passes. Time-bounded so a hung tool can't stall an incident turn forever.
 */
export type ReadOnlyExecutor = (
  command: string,
  args: string[],
  opts?: ExecOptions,
) => Promise<ExecResult>;

export function execReadOnly(
  command: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const { timeoutMs = 10_000, maxBufferBytes = 8 * 1024 * 1024 } = opts;

  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle(() => reject(new Error(`command timed out after ${timeoutMs}ms: ${command}`)));
    }, timeoutMs);

    // Accumulate stdout/stderr and enforce a combined byte ceiling.
    // Use chunk.length (byte count) rather than character count after toString()
    // so multi-byte UTF-8 characters are counted accurately.
    const onData = (kind: "stdout" | "stderr") => (chunk: Buffer): void => {
      totalBytes += chunk.length;
      if (totalBytes > maxBufferBytes) {
        child.kill("SIGTERM");
        settle(() =>
          reject(new Error(`combined output exceeded ${maxBufferBytes} bytes: ${command}`)),
        );
        return;
      }
      const text = chunk.toString("utf8");
      if (kind === "stdout") stdout += text;
      else stderr += text;
    };
    child.stdout?.on("data", onData("stdout"));
    child.stderr?.on("data", onData("stderr"));

    child.on("error", (err) => settle(() => reject(err)));

    child.on("close", (code) =>
      settle(() => {
        const exitCode = code ?? -1;
        if (exitCode === 0) resolve({ stdout, stderr, exitCode });
        else reject(new ExecError(`command exited ${exitCode}: ${command}`, exitCode, stdout, stderr));
      }),
    );
  });
}
