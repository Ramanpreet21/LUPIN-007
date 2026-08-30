import type { NormalizedAlert } from "./incidents";

/**
 * Pre-session system state capture (PR #5 §5c).
 * Captures live target state (process tree, network connections, service status)
 * before starting a diagnostic session so reasoning is grounded in real telemetry.
 */

export interface ProbeResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface CapturedSystemState {
  targetHost: string;
  serviceName?: string;
  timestamp: string;
  processTree: string;
  networkConnections: string;
  serviceStatus: string;
  isSynthetic?: boolean;
  probes?: {
    processes: ProbeResult;
    network: ProbeResult;
    service?: ProbeResult;
  };
  captureStatus?: "success" | "partial_failure" | "failed";
  systemSummary?: {
    loadAverage?: string;
    memoryFreeMb?: number;
    diskFreeGb?: number;
  };
}

export interface CaptureExecutorOptions {
  /** Custom command runner (e.g. SSH client, local exec, or mock test runner). Can accept an AbortSignal. */
  executor?: (cmd: string, host: string, signal?: AbortSignal) => Promise<string>;
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
    captureStatus: "success",
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
  targetHostOrAlert: string | NormalizedAlert,
  serviceName?: string,
  opts?: CaptureExecutorOptions,
): Promise<CapturedSystemState> {
  const targetHost = typeof targetHostOrAlert === "string" ? targetHostOrAlert : targetHostOrAlert.target_host;
  const service = typeof targetHostOrAlert === "string" ? serviceName : targetHostOrAlert.service_name;

  const runner = opts?.executor;
  const timeout = opts?.timeoutMs ?? 3500;

  if (!runner) {
    return generateSyntheticState(targetHost, service);
  }

  const execSafe = async (cmd: string): Promise<ProbeResult> => {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      const runnerPromise = runner(cmd, targetHost, controller.signal);
      const timeoutPromise = new Promise<string>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Command timed out after ${timeout}ms: ${cmd}`));
        }, timeout);
      });
      const output = await Promise.race([runnerPromise, timeoutPromise]);
      return { success: true, output: output.trim() };
    } catch (err) {
      controller.abort();
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `[Capture probe error: ${errorMsg}]`, error: errorMsg };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const rawService = service ? service.trim() : "";
  const safeService = /^[a-zA-Z0-9_.\-@]+$/.test(rawService) ? rawService : "";
  const [procRes, netRes, svcRes] = await Promise.all([
    execSafe("ps aux --forest || ps -ef"),
    execSafe("ss -tulnp || netstat -tulnp"),
    safeService
      ? execSafe(`systemctl status ${safeService} || service ${safeService} status`)
      : rawService
        ? Promise.resolve({ success: false, output: "[Invalid service name format for probe]", error: "Invalid service name format" })
        : Promise.resolve(undefined),
  ]);

  const activeProbes = [procRes, netRes, ...(svcRes ? [svcRes] : [])];
  const successCount = activeProbes.filter((p) => p.success).length;
  const captureStatus: "success" | "partial_failure" | "failed" =
    successCount === activeProbes.length
      ? "success"
      : successCount === 0
        ? "failed"
        : "partial_failure";

  return {
    targetHost,
    serviceName: service,
    isSynthetic: false,
    timestamp: new Date().toISOString(),
    processTree: procRes.output,
    networkConnections: netRes.output,
    serviceStatus: svcRes ? svcRes.output : (rawService ? "[Invalid service name format for probe]" : "No target service specified."),
    probes: {
      processes: procRes,
      network: netRes,
      ...(svcRes ? { service: svcRes } : {}),
    },
    captureStatus,
  };
}

/**
 * Serialize a CapturedSystemState into the structured prompt format specified in PR #5 §5c.
 */
export function formatCapturedState(state: CapturedSystemState): string {
  let header: string;
  if (state.isSynthetic) {
    header = `## CAPTURED SYSTEM STATE (synthetic baseline - target host ${state.targetHost} unattached)`;
  } else if (state.captureStatus === "failed") {
    header = `## CAPTURED SYSTEM STATE (FAILED capture from ${state.targetHost} - telemetry unavailable)`;
  } else if (state.captureStatus === "partial_failure") {
    header = `## CAPTURED SYSTEM STATE (PARTIAL capture from ${state.targetHost} - some probes failed)`;
  } else {
    header = `## CAPTURED SYSTEM STATE (live snapshot from ${state.targetHost})`;
  }

  const sections = [
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
  ];

  return sections.join("\n");
}
