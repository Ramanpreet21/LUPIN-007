/**
 * Command blast-radius scoping and resource impact annotation (PR #5 §5d).
 * Parses proposed remediation commands, cross-references static resource maps,
 * and annotates affected files, ports, sockets, and services for the approval gate.
 */

export interface CommandScope {
  command: string;
  executable: string;
  subcommand?: string;
  files: string[];
  sockets: string[];
  services: string[];
  ports: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  impactSummary: string;
}

interface ShellToken {
  word: string;
  start: number;
}

/** Quote-aware shell statement splitter for compound commands. */
export function splitCompoundStatements(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "\n" || ch === ";" || ch === "&" || ch === "|") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

/** Quote and parenthesis-aware command substitution extractor (handles $(...), <(...), >(...), and `...`). */
export function extractCommandSubstitutions(command: string): string[] {
  const subs: string[] = [];

  // 1. Balanced $(...), <(...), >(...) extractor
  for (let i = 0; i < command.length - 1; i++) {
    const isSub = (command[i] === "$" || command[i] === "<" || command[i] === ">") && command[i + 1] === "(";
    if (isSub) {
      let depth = 1;
      let start = i + 2;
      let j = start;
      let inQuote: string | null = null;
      let isEsc = false;

      while (j < command.length && depth > 0) {
        const c = command[j];
        if (isEsc) {
          isEsc = false;
          j++;
          continue;
        }
        if (c === "\\") {
          isEsc = true;
          j++;
          continue;
        }
        if (inQuote) {
          if (c === inQuote) inQuote = null;
          j++;
          continue;
        }
        if (c === "'" || c === '"') {
          inQuote = c;
          j++;
          continue;
        }
        if (c === "(") {
          depth++;
        } else if (c === ")") {
          depth--;
          if (depth === 0) {
            const inner = command.slice(start, j).trim();
            if (inner) {
              const compoundParts = splitCompoundStatements(inner);
              subs.push(...compoundParts);
              subs.push(...extractCommandSubstitutions(inner));
            }
            break;
          }
        }
        j++;
      }
    }
  }

  // 2. Backtick `...` extractor
  const backtickRegex = /`([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickRegex.exec(command)) !== null) {
    if (match[1]?.trim()) {
      const inner = match[1].trim();
      const compoundParts = splitCompoundStatements(inner);
      subs.push(...compoundParts);
      subs.push(...extractCommandSubstitutions(inner));
    }
  }

  return Array.from(new Set(subs));
}

/** Quote-aware shell tokenizer for statement words, splitting attached redirections. */
export function tokenizeShellWords(input: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let current = "";
  let start = -1;
  let inWord = false;
  let quote: string | null = null;
  let escaped = false;

  const flush = () => {
    if (inWord && current) {
      // Split on embedded unquoted redirection operators (e.g. echo val>/etc/shadow -> "val", ">/etc/shadow")
      const redirMatch = /(.*?)(?<!\\)((?:\d*>>|\d*>|&>>|&>|>>|>|<+)\S+)/.exec(current);
      if (redirMatch && redirMatch[1]) {
        tokens.push({ word: redirMatch[1], start });
        tokens.push({ word: redirMatch[2], start: start + redirMatch[1].length });
      } else {
        tokens.push({ word: current, start });
      }
      current = "";
      start = -1;
      inWord = false;
    }
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (!inWord) {
        inWord = true;
        start = i;
      }
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (!inWord) start = i;
      inWord = true;
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    if (!inWord) {
      inWord = true;
      start = i;
    }
    current += ch;
  }
  flush();
  return tokens;
}

const KNOWN_SERVICE_PORTS: Record<string, { ports: string[]; sockets: string[]; defaultFiles: string[] }> = {
  nginx: {
    ports: ["80", "443"],
    sockets: ["tcp/80", "tcp/443"],
    defaultFiles: ["/etc/nginx/nginx.conf", "/etc/systemd/system/nginx.service"],
  },
  postgresql: {
    ports: ["5432"],
    sockets: ["tcp/5432", "unix:/run/postgresql/.s.PGSQL.5432"],
    defaultFiles: ["/etc/postgresql/16/main/postgresql.conf", "/var/lib/postgresql"],
  },
  postgres: {
    ports: ["5432"],
    sockets: ["tcp/5432", "unix:/run/postgresql/.s.PGSQL.5432"],
    defaultFiles: ["/etc/postgresql/16/main/postgresql.conf", "/var/lib/postgresql"],
  },
  sshd: {
    ports: ["22"],
    sockets: ["tcp/22"],
    defaultFiles: ["/etc/ssh/sshd_config"],
  },
  k3s: {
    ports: ["6443"],
    sockets: ["tcp/6443"],
    defaultFiles: ["/etc/rancher/k3s/k3s.yaml", "/var/lib/rancher/k3s"],
  },
  redis: {
    ports: ["6379"],
    sockets: ["tcp/6379", "unix:/var/run/redis/redis-server.sock"],
    defaultFiles: ["/etc/redis/redis.conf", "/var/lib/redis"],
  },
  "lupin-relay": {
    ports: ["8080"],
    sockets: ["tcp/8080", "unix:/run/relay.sock"],
    defaultFiles: ["/etc/systemd/system/lupin-relay.service"],
  },
};

const PURE_READ_ONLY = new Set([
  "ls", "ps", "top", "htop", "cat", "head", "tail", "grep", "awk",
  "df", "du", "free", "uptime", "uname", "hostname", "whoami", "id",
  "ping", "traceroute", "netstat", "ss", "ip", "dig", "journalctl", "dmesg",
]);

const REDIRECTION_PREFIX_REGEX = /^(?:\d*>>|\d*>|&>>|&>|>>|>|<+)/;
const SUDO_VALUE_OPTIONS = new Set([
  "-u", "-g", "-C", "-p", "-h", "-r", "-t", "-U", "-D",
  "--user", "--group", "--chdir", "--prompt", "--host", "--other-user",
]);

const SYSTEMCTL_VALUE_OPTIONS = new Set([
  "-H", "--host", "-M", "--machine", "-p", "--property",
  "-t", "--type", "-s", "--signal", "-n", "--lines", "-o", "--output", "--root",
]);

function extractPaths(tokens: string[]): string[] {
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^(?:\/|\.\/|~\/|\.\.\/)/.test(t)) {
      paths.push(t);
    } else if (REDIRECTION_PREFIX_REGEX.test(t)) {
      const target = t.replace(REDIRECTION_PREFIX_REGEX, "");
      if (target && /^(?:\/|\.\/|~\/|\.\.\/|[a-zA-Z0-9_.-])/.test(target)) {
        paths.push(target);
      } else if (tokens[i + 1] && !tokens[i + 1].startsWith("-")) {
        paths.push(tokens[i + 1]);
      }
    }
  }
  return paths;
}

const RISK_WEIGHTS = { low: 1, medium: 2, high: 3, critical: 4 };

function pickHighestRisk(r1: CommandScope["riskLevel"], r2: CommandScope["riskLevel"]): CommandScope["riskLevel"] {
  return RISK_WEIGHTS[r1] >= RISK_WEIGHTS[r2] ? r1 : r2;
}

/**
 * Annotate a single simple statement.
 */
function annotateSingleStatement(statement: string): CommandScope {
  const trimmed = statement.trim();
  const tokens = tokenizeShellWords(trimmed).map((t) => t.word);

  if (tokens.length === 0) {
    return {
      command: trimmed,
      executable: "",
      files: [],
      sockets: [],
      services: [],
      ports: [],
      riskLevel: "low",
      impactSummary: "Empty command",
    };
  }

  // Peel leading environment assignments and sudo/wrapper prefixes
  let idx = 0;
  while (idx < tokens.length) {
    const word = tokens[idx];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || word === "export") {
      idx++;
      continue;
    }
    if (["sudo", "nohup", "time", "command", "exec", "nice", "env"].includes(word)) {
      idx++;
      while (idx < tokens.length && tokens[idx].startsWith("-")) {
        idx += SUDO_VALUE_OPTIONS.has(tokens[idx]) ? 2 : 1;
      }
      continue;
    }
    if (word === "eval") {
      idx++;
      if (tokens[idx]) {
        return annotateCommandScope(tokens.slice(idx).join(" "));
      }
      continue;
    }
    // sh -c / bash -c unwrapping: recurse into full annotateCommandScope to handle compound inner scripts
    if (["sh", "bash", "zsh", "dash"].includes(word)) {
      if (tokens[idx + 1] === "-c" && tokens[idx + 2]) {
        return annotateCommandScope(tokens[idx + 2]);
      }
    }
    break;
  }

  const effectiveExecutable = tokens[idx] ? tokens[idx].slice(tokens[idx].lastIndexOf("/") + 1) : "";
  const rawArgs = tokens.slice(idx + 1);

  // Filter out options and their operands for systemctl
  const positionalArgs: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (effectiveExecutable === "systemctl" && SYSTEMCTL_VALUE_OPTIONS.has(arg)) {
      i++; // Skip option operand
      continue;
    }
    if (arg.startsWith("-") || REDIRECTION_PREFIX_REGEX.test(arg)) {
      continue;
    }
    positionalArgs.push(arg);
  }

  const explicitPaths = extractPaths(rawArgs);
  const hasWriteRedirection = rawArgs.some((a) => /^(?:\d*>>|\d*>|&>>|&>|>>|>)/.test(a));

  const scope: CommandScope = {
    command: trimmed,
    executable: effectiveExecutable || tokens[0],
    files: [...explicitPaths],
    sockets: [],
    services: [],
    ports: [],
    riskLevel: "low",
    impactSummary: "Standard execution",
  };

  switch (effectiveExecutable) {
    case "systemctl":
    case "service": {
      const action = effectiveExecutable === "systemctl" ? positionalArgs[0] : positionalArgs[1];
      const targetSvc = (effectiveExecutable === "systemctl" ? positionalArgs[1] : positionalArgs[0])?.replace(/\.service$/, "");
      scope.subcommand = action;
      if (targetSvc) {
        scope.services.push(`${targetSvc} (${action || "action"})`);
        const known = KNOWN_SERVICE_PORTS[targetSvc];
        if (known) {
          scope.ports.push(...known.ports);
          scope.sockets.push(...known.sockets);
          scope.files.push(...known.defaultFiles);
        } else {
          scope.files.push(`/etc/systemd/system/${targetSvc}.service`);
        }
      }
      if (["stop", "disable", "mask"].includes(action)) {
        scope.riskLevel = "high";
        scope.impactSummary = `Halts service ${targetSvc || "unit"}; downstream connections will drop`;
      } else if (["restart", "reload", "start", "enable", "unmask", "try-restart", "isolate"].includes(action)) {
        scope.riskLevel = "medium";
        scope.impactSummary = `Mutates state of service ${targetSvc || "unit"} (${action})`;
      } else {
        scope.riskLevel = "low";
        scope.impactSummary = `Queries status for ${targetSvc || "service"}`;
      }
      break;
    }

    case "rm":
    case "unlink": {
      scope.riskLevel = rawArgs.some((a) => a.includes("*") || a === "-rf" || a === "-fr" || a === "--no-preserve-root")
        ? "critical"
        : "high";
      scope.impactSummary = `Deletes files (${explicitPaths.join(", ") || "target paths"})`;
      break;
    }

    case "mkfs":
    case "fdisk":
    case "parted":
    case "dd": {
      scope.riskLevel = "critical";
      scope.impactSummary = `Raw block device modification (${explicitPaths.join(", ") || "storage device"})`;
      break;
    }

    case "chmod":
    case "chown": {
      scope.riskLevel = rawArgs.includes("777") || rawArgs.includes("a+rwx") || rawArgs.includes("-R") ? "high" : "medium";
      scope.impactSummary = `Mutates permissions/ownership on ${explicitPaths.join(", ") || "targets"}`;
      break;
    }

    case "sed": {
      if (rawArgs.includes("-i") || rawArgs.some((a) => a.startsWith("-i"))) {
        scope.riskLevel = "medium";
        scope.impactSummary = `In-place text mutation on ${explicitPaths.join(", ") || "target file"}`;
      } else {
        scope.riskLevel = "low";
        scope.impactSummary = "Stream text processing";
      }
      break;
    }

    case "curl":
    case "wget": {
      if (rawArgs.includes("-o") || rawArgs.includes("-O") || rawArgs.includes("--output")) {
        scope.riskLevel = "medium";
        scope.impactSummary = `Downloads payload to local filesystem (${explicitPaths.join(", ") || "target file"})`;
      } else {
        scope.riskLevel = "low";
        scope.impactSummary = "HTTP/network data retrieval";
      }
      break;
    }

    case "kill":
    case "pkill":
    case "killall": {
      const targetProc = positionalArgs[0];
      if (targetProc) scope.services.push(targetProc);
      scope.riskLevel = rawArgs.includes("-9") || rawArgs.includes("-KILL") ? "high" : "medium";
      scope.impactSummary = `Terminates process target ${targetProc || "PID"}`;
      break;
    }

    case "reboot":
    case "shutdown":
    case "poweroff":
    case "halt":
    case "init": {
      scope.riskLevel = "critical";
      scope.impactSummary = `System power state transition (${effectiveExecutable})`;
      break;
    }

    case "swapoff":
    case "swapon": {
      scope.riskLevel = "high";
      scope.impactSummary = "Modifies virtual memory swap configuration";
      break;
    }

    case "useradd":
    case "userdel":
    case "usermod":
    case "passwd": {
      scope.riskLevel = "high";
      scope.files.push("/etc/passwd", "/etc/shadow");
      scope.impactSummary = "Modifies user identity or system authentication accounts";
      break;
    }

    case "docker":
    case "podman": {
      const sub = positionalArgs[0];
      scope.subcommand = sub;
      scope.sockets.push(effectiveExecutable === "docker" ? "unix:/var/run/docker.sock" : "unix:/run/podman/podman.sock");
      if (["rm", "kill", "stop"].includes(sub)) {
        scope.riskLevel = "high";
        scope.impactSummary = `Container ${positionalArgs[1] || "instance"} mutation/termination`;
      } else {
        scope.riskLevel = "medium";
        scope.impactSummary = `Container management (${sub || "inspect"})`;
      }
      break;
    }

    case "iptables":
    case "ufw":
    case "nft": {
      scope.riskLevel = "high";
      scope.sockets.push("kernel:netfilter");
      scope.impactSummary = "Network packet filtering and firewall configuration";
      break;
    }

    default: {
      if (hasWriteRedirection) {
        scope.riskLevel = explicitPaths.some((p) => p.startsWith("/etc/sudoers") || p.startsWith("/etc/shadow")) ? "critical" : "medium";
        scope.impactSummary = `Writes output stream to ${explicitPaths.join(", ") || "file target"}`;
      } else if (explicitPaths.some((p) => p.startsWith("/etc/shadow") || p.startsWith("/etc/sudoers"))) {
        scope.riskLevel = "critical";
        scope.impactSummary = "Accesses sensitive authentication credentials";
      } else if (PURE_READ_ONLY.has(effectiveExecutable)) {
        scope.riskLevel = "low";
        scope.impactSummary = `Read-only diagnostic query (${effectiveExecutable})`;
      } else if (explicitPaths.length > 0) {
        scope.riskLevel = "medium";
        scope.impactSummary = `Operates on filesystem paths (${explicitPaths.join(", ")})`;
      } else {
        scope.riskLevel = "medium";
        scope.impactSummary = `Unknown command (${effectiveExecutable || "unrecognized"}) — operator should verify impact`;
      }
      break;
    }
  }

  return scope;
}

/**
 * Annotate a single shell command (including compound/piped statements and substitutions) with its touched resources and blast radius.
 */
export function annotateCommandScope(command: string): CommandScope {
  const trimmed = command.trim();
  const subStatements = splitCompoundStatements(trimmed);
  const substitutions = extractCommandSubstitutions(trimmed);
  const allSubCommands = Array.from(new Set([...subStatements, ...substitutions]));

  if (allSubCommands.length <= 1) {
    const single = annotateSingleStatement(trimmed);
    single.files = Array.from(new Set(single.files));
    single.ports = Array.from(new Set(single.ports));
    single.sockets = Array.from(new Set(single.sockets));
    single.services = Array.from(new Set(single.services));
    return single;
  }

  // Compound command or nested substitutions: evaluate each part and combine blast radius
  const parts = allSubCommands.map(annotateSingleStatement);
  let aggregateRisk: CommandScope["riskLevel"] = "low";
  const allFiles: string[] = [];
  const allSockets: string[] = [];
  const allServices: string[] = [];
  const allPorts: string[] = [];
  const summaries: string[] = [];

  for (const part of parts) {
    aggregateRisk = pickHighestRisk(aggregateRisk, part.riskLevel);
    allFiles.push(...part.files);
    allSockets.push(...part.sockets);
    allServices.push(...part.services);
    allPorts.push(...part.ports);
    if (part.impactSummary && part.impactSummary !== "Empty command") {
      summaries.push(part.impactSummary);
    }
  }

  return {
    command: trimmed,
    executable: parts[0]?.executable || "",
    subcommand: parts[0]?.subcommand,
    files: Array.from(new Set(allFiles)),
    sockets: Array.from(new Set(allSockets)),
    services: Array.from(new Set(allServices)),
    ports: Array.from(new Set(allPorts)),
    riskLevel: aggregateRisk,
    impactSummary: summaries.join(" | ") || "Compound command execution",
  };
}

/**
 * Annotate a batch of proposed commands.
 */
export function annotateCommandsScope(commands: string[]): CommandScope[] {
  return commands.map(annotateCommandScope);
}

/**
 * Format a list of proposed commands with scoped blast-radius annotations for the approval panel diff.
 */
export function formatScopedDiff(commands: string[]): string {
  const scopes = annotateCommandsScope(commands);
  const blocks: string[] = [];

  for (const s of scopes) {
    const lines: string[] = [`+ ${s.command}`];
    if (s.files.length > 0) lines.push(`  files:    ${s.files.join(", ")}`);
    if (s.sockets.length > 0) lines.push(`  sockets:  ${s.sockets.join(", ")}`);
    if (s.services.length > 0) lines.push(`  services: ${s.services.join(", ")}`);
    if (s.ports.length > 0) lines.push(`  ports:    ${s.ports.join(", ")}`);
    if (s.riskLevel !== "low") lines.push(`  impact:   [${s.riskLevel.toUpperCase()}] ${s.impactSummary}`);
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}
