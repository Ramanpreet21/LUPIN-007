/**
 * Pre-session system state capture (PR #5 §5c).
 * Captures live target state (process tree, network connections, service status)
 * before starting a diagnostic session so reasoning is grounded in real telemetry.
 */

export interface CapturedSystemState {
  targetHost: string;
  serviceName?: string;
  timestamp: string;
  processTree: string;
  networkConnections: string;
  serviceStatus: string;
  isSynthetic?: boolean;
  systemSummary?: {
    loadAverage?: string;
    memoryFreeMb?: number;
    diskFreeGb?: number;
  };
}

export interface CaptureExecutorOptions {
  /** Custom command runner (e.g. SSH client, local exec, or mock test runner). */
  executor?: (cmd: string, host: string) => Promise<string>;
  /** Timeout per command in milliseconds (default: 3500ms). */
  timeoutMs?: number;
}

/** Default mock / synthetic generator for unreachable, local test, or demo targets. */
function generateSyntheticState(targetHost: string, serviceName?: string): CapturedSystemState {
  const service = serviceName ?? "systemd";
  return {
    targetHost,
    serviceName,
    isSynthetic: true,
    timestamp: new Date().toISOString(),
    processTree: [
      `systemd(1)─┬─${service}(619)───worker(804)`,
      `           ├─sshd(412)───sshd(1084)───bash(1085)`,
      `           ├─systemd-journal(288)`,
      `           └─nginx(214)───nginx(215)`,
    ].join("\n"),
    networkConnections: [
      `tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=412,fd=3))`,
      `tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=214,fd=6))`,
      `tcp LISTEN 0 511 0.0.0.0:443 0.0.0.0:* users:(("nginx",pid=214,fd=7))`,
      `tcp LISTEN 0 128 127.0.0.1:8080 0.0.0.0:* users:(("${service}",pid=619,fd=4))`,
    ].join("\n"),
    serviceStatus: [
      `● ${service}.service - Core Application Service`,
      `     Loaded: loaded (/etc/systemd/system/${service}.service; enabled; preset: enabled)`,
      `     Active: active (running) since ${new Date(Date.now() - 3600000).toUTCString()}`,
      `   Main PID: 619 (${service})`,
      `      Tasks: 14 (limit: 4915)`,
      `     Memory: 418.0M`,
      `        CPU: 12.4s`,
      `     CGroup: /system.slice/${service}.service`,
      `             └─619 /usr/bin/${service} --config /etc/${service}.conf`,
    ].join("\n"),
    systemSummary: {
      loadAverage: "0.42, 0.38, 0.29",
      memoryFreeMb: 6840,
      diskFreeGb: 184,
    },
  };
}

/**
 * Capture live system state from target host before TrueForge turn creation.
 * Resilient: Never throws or halts incident processing; falls back to synthetic
 * inspection or capture error summaries on remote command failure.
 */
export async function captureTargetState(
  targetHost: string,
  serviceName?: string,
  opts?: CaptureExecutorOptions,
): Promise<CapturedSystemState> {
  const runner = opts?.executor;
  const timeout = opts?.timeoutMs ?? 3500;

  if (!runner) {
    return generateSyntheticState(targetHost, serviceName);
  }

  const execSafe = async (cmd: string): Promise<string> => {
    try {
      const runnerPromise = runner(cmd, targetHost);
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`Command timed out after ${timeout}ms: ${cmd}`)), timeout),
      );
      return await Promise.race([runnerPromise, timeoutPromise]);
    } catch (err) {
      return `[Capture probe error: ${err instanceof Error ? err.message : String(err)}]`;
    }
  };

  const rawService = serviceName ? serviceName.trim() : "";
  const safeService = /^[a-zA-Z0-9_.\-@]+$/.test(rawService) ? rawService : "";
  const [procTree, netConn, svcStatus] = await Promise.all([
    execSafe("ps aux --forest || ps -ef"),
    execSafe("ss -tulnp || netstat -tulnp"),
    safeService
      ? execSafe(`systemctl status ${safeService} || service ${safeService} status`)
      : Promise.resolve(rawService ? "[Invalid service name format for probe]" : "No target service specified."),
  ]);

  return {
    targetHost,
    serviceName,
    isSynthetic: false,
    timestamp: new Date().toISOString(),
    processTree: procTree.trim(),
    networkConnections: netConn.trim(),
    serviceStatus: svcStatus.trim(),
  };
}

/**
 * Serialize a CapturedSystemState into the structured prompt format specified in PR #5 §5c.
 */
export function formatCapturedState(state: CapturedSystemState): string {
  const header = state.isSynthetic
    ? `## CAPTURED SYSTEM STATE (synthetic baseline - target host ${state.targetHost} unattached)`
    : `## CAPTURED SYSTEM STATE (live snapshot from ${state.targetHost})`;

  return [
    header,
    "Process tree:",
    state.processTree || "(no process tree recorded)",
    "",
    "Network connections:",
    state.networkConnections || "(no active listening sockets recorded)",
    "",
    "Service status:",
    state.serviceStatus || "(no service status recorded)",
    "",
  ].join("\n");
}
