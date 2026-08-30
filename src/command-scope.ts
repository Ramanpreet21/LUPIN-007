import { effectiveCommand, shellWords, splitShellStatements, extractCompoundStatements } from "./shell-parse";

/**
 * What a proposed command would touch, rendered for the operator's blast-radius
 * view at the approval gate (5d). All fields are heuristic — see the note on
 * effectiveCommand — and local-display only; real enforcement stays on the
 * TrueForge connector's requireApprovalForTools.
 */
export interface CommandScope {
  command: string;
  /** Resolved executable (wrapper words peeled, `sh -c` unwrapped). */
  executable: string;
  files: string[];
  sockets: string[];
  ports: string[];
  services: string[];
  risk: "low" | "high";
  /** True when the executable has no static resource map — operator should verify. */
  unknown: boolean;
}

interface ResourceDef {
  files?: string[];
  sockets?: string[];
  ports?: string[];
  services?: string[];
}

/**
 * Known binaries and the host resources they touch. Deliberately small and
 * static: it annotates the common operations a responder proposes; anything
 * else falls back to `unknown` and the operator decides.
 */
const RESOURCE_MAP: Record<string, ResourceDef> = {
  nginx: { files: ["/etc/nginx/"], sockets: ["tcp/80", "tcp/443"], ports: ["80", "443"], services: ["nginx"] },
  sshd: { files: ["/etc/ssh/"], sockets: ["tcp/22"], ports: ["22"], services: ["sshd"] },
  systemctl: { files: ["/etc/systemd/system/"] },
  systemd: { files: ["/etc/systemd/system/"] },
  journalctl: { files: ["/var/log/journal/"] },
  docker: { sockets: ["unix:/var/run/docker.sock"], services: ["docker"] },
  "firewall-cmd": { sockets: [], services: ["firewalld"] },
  ufw: { sockets: [], services: ["ufw"] },
};

/** Executables whose non-flag arguments are file paths worth surfacing. */
const FILE_ARG_BINARIES = new Set(["rm"]);

/** The knob that makes a gate command read as high risk (5d/5e badge interplay). */
const HIGH_RISK_MARKERS: RegExp[] = [
  /\/etc\/shadow\b/,
  /\brm\b\s+-r[a-z]*\b/,
  /\bchmod\s+777\b/,
  /\bsystemctl\s+(?:stop|disable|kill|mask)\b/,
  /\b(?:ssh|scp|sftp)\b/,
  /\btcp\/22\b/,
  /(?:^|[^\dA-Za-z]):22\b/,
  /\b-p\s+22\b/,
  /\b(?:curl|wget)\b\s+.*(?:-T\b|--upload-file\b|-d\s*@|--post-file\b|--post-data\b|-F\b|--form\b)/,
];

function addUnique(target: string[], values: string[]): void {
  for (const v of values) if (!target.includes(v)) target.push(v);
}

/** Known flags that consume the following token as a value, not a unit/action. */
const SYSTEMCTL_VALUE_FLAGS = new Set(["--host", "-H", "--machine", "-M", "-u", "--unit"]);

/**
 * Compute blast-radius annotation for one shell statement. Extracted so it can
 * be called per statement when the tool call contains semicolon-chained commands.
 * Findings #9, #10.
 */
function scopeStatement(statement: string): CommandScope {
  const effective = effectiveCommand(statement);
  const tokens = shellWords(effective);
  const raw = tokens[0]?.word ?? "";
  const executable = raw.slice(raw.lastIndexOf("/") + 1);
  const args = tokens.slice(1).map((t) => t.word);

  const base = RESOURCE_MAP[executable];
  const files = [...(base?.files ?? [])];
  const sockets = [...(base?.sockets ?? [])];
  const ports = [...(base?.ports ?? [])];
  const services = [...(base?.services ?? [])];

  if (executable === "systemctl") {
    // Flags that consume the next token as a value — skip both flag and value.
    // Fixes: systemctl --host node-a stop nginx
    //   → action=stop, unit=nginx (not action=nginx, unit=stop)
    const skipNext = new Set<string>();
    let i = 0;
    while (i < args.length) {
      const arg = args[i];
      if (skipNext.size > 0) {
        skipNext.delete(arg);
        i++;
        continue;
      }
      if (SYSTEMCTL_VALUE_FLAGS.has(arg)) {
        skipNext.add(args[i + 1] ?? "");
        i++;
        continue;
      }
      if (arg.startsWith("-")) {
        i++;
        continue;
      }
      // First non-flag token is the action; second is the unit
      const action = arg;
      const unit = args[i + 1];
      if (action && unit && /^[A-Za-z0-9_.:@-]{1,255}$/.test(unit)) {
        if (!services.includes(unit)) services.push(unit);
        const def = RESOURCE_MAP[unit.replace(/\.service$/, "")];
        if (def) {
          addUnique(files, def.files ?? []);
          addUnique(sockets, def.sockets ?? []);
          addUnique(ports, def.ports ?? []);
        }
      }
      break;
    }
  }

  if (FILE_ARG_BINARIES.has(executable)) {
    for (const a of args) if (!a.startsWith("-")) addUnique(files, [a]);
  }

  const risk: "low" | "high" = HIGH_RISK_MARKERS.some((m) => m.test(statement) || m.test(effective)) ? "high" : "low";

  return {
    command: statement,
    executable: executable || "(none)",
    files,
    sockets,
    ports,
    services,
    risk,
    unknown: !(executable in RESOURCE_MAP) || executable === "",
  };
}

/**
 * What a proposed command would touch, rendered for the operator's blast-radius
 * view at the approval gate (5d). All fields are heuristic — see the note on
 * effectiveCommand — and local-display only; real enforcement stays on the
 * TrueForge connector's requireApprovalForTools.
 *
 * Returns one CommandScope per semicolon-separated statement so chained commands
 * (e.g. "systemctl restart nginx; rm -rf /tmp/x") show each statement's blast
 * radius individually. Finding #9.
 */
export function commandScope(command: string): CommandScope[] {
  return extractCompoundStatements(command).map(scopeStatement);
}

