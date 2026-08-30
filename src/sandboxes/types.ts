export type SandboxType =
  | "daytona"
  | "daytona-custom"
  | "podman"
  | "docker"
  | "isolated-local";

export interface SandboxProbeResult {
  available: boolean;
  type: SandboxType;
  socketPath?: string;
  serverUrl?: string;
  latencyMs?: number;
  error?: string;
  details?: string;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SandboxRunner {
  readonly type: SandboxType;
  probe(config?: { socketPath?: string; serverUrl?: string; apiKey?: string }): Promise<SandboxProbeResult>;
  createSession(sessionId: string, env?: Record<string, string>): Promise<{ sandboxId: string }>;
  exec(sandboxId: string, command: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<SandboxExecResult>;
  destroySession(sandboxId: string): Promise<void>;
}
