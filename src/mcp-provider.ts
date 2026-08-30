import { Router, type Request, type Response } from "express";
import { realpathSync } from "node:fs";
import { openSync, closeSync } from "node:fs";
import { execReadOnly, type ExecError, type ReadOnlyExecutor } from "./exec-readonly";

export const LOCAL_MCP_NAME = "incident-deck-mcp";

/** Single source of truth for the local tool catalog (5b). */
export const TOOL_NAMES = [
  "system_snapshot",
  "process_tree",
  "net_connections",
  "service_status",
  "journal_logs",
  "file_read",
  "dns_lookup",
] as const;

/**
 * Build the URL TrueForge should use to reach the local MCP provider.
 *
 * Topology logic:
 *   - CONTROL_PLANE_URL is set → use it directly as the MCP base URL.
 *     This is the only way to correctly handle remote/containerized deployments
 *     because it is the only config that names the control plane's externally
 *     reachable address (not TrueForge's).
 *   - Otherwise → same-host deployment; advertise loopback.
 *
 * Ephemeral-port note: callers MUST pass the actual bound port (from
 * server.address().port after listen()), not the configured port, so
 * PORT=0 works correctly (finding #3).
 */
export function buildLocalMcpUrl(
  port: number,
  controlPlaneUrl?: string,
): string {
  if (controlPlaneUrl) {
    try {
      const base = new URL(controlPlaneUrl);
      return `${base.origin}/mcp`;
    } catch {
      // Invalid URL — fall back to loopback.
    }
  }
  return `http://127.0.0.1:${port}/mcp`;
}

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_VERSION = "0.1.0";
/** Absolute prefixes file_read may open. Everything else is refused. */
const ALLOWED_READ_PREFIXES = ["/etc/nginx/", "/opt/", "/usr/local/etc/"] as const;
const UNIT_NAME = /^[a-zA-Z0-9_.:@-]{1,255}$/;
const HOSTNAME = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "system_snapshot",
    description:
      "Composite read-only snapshot of the host: processes, listening sockets, mounts, disk and memory usage.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "process_tree",
    description: "Process list rendered as a parent/child tree (ps aux --forest).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "net_connections",
    description: "Listening sockets and established connections (ss -tulnp).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "service_status",
    description: "systemd unit status (systemctl status, last 40 lines).",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "systemd unit name, e.g. nginx" },
      },
      required: ["service"],
    },
  },
  {
    name: "journal_logs",
    description: "Recent journal entries for a systemd unit (journalctl -u).",
    inputSchema: {
      type: "object",
      properties: {
        unit: { type: "string", description: "systemd unit name, e.g. nginx.service" },
        since: { type: "string", description: "journalctl --since expression (default '1 hour ago')" },
        lines: {
          type: "integer",
          description: "number of lines to return (1-1000, default 100)",
        },
      },
      required: ["unit"],
    },
  },
  {
    name: "file_read",
    description: "Read a config file under an authorized path (/etc/nginx/, /opt/).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "absolute path under an authorized prefix" },
      },
      required: ["path"],
    },
  },
  {
    name: "dns_lookup",
    description: "Resolve a hostname (getent hosts).",
    inputSchema: {
      type: "object",
      properties: { hostname: { type: "string" } },
      required: ["hostname"],
    },
  },
];

interface JsonRpcError {
  code: number;
  message: string;
}

type JsonRpcOutcome = { result: unknown } | { error: JsonRpcError };

const error = (code: number, message: string): JsonRpcError => ({ code, message });

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

interface SnapshotJob {
  label: string;
  command: string;
  args: string[];
}

async function snapshotSections(executor: ReadOnlyExecutor): Promise<string[]> {
  const jobs: SnapshotJob[] = [
    { label: "Processes (ps aux)", command: "ps", args: ["aux"] },
    { label: "Sockets (ss -tulnp)", command: "ss", args: ["-tulnp"] },
    { label: "Mounts", command: "mount", args: [] },
    { label: "Disk (df -h)", command: "df", args: ["-h"] },
    { label: "Memory (free -m)", command: "free", args: ["-m"] },
  ];
  return Promise.all(
    jobs.map(async ({ label, command, args }) => {
      try {
        const { stdout } = await executor(command, args);
        return `${label}:\n${stdout.trim() || "(no output)"}`;
      } catch {
        return `${label}: (unavailable)`;
      }
    }),
  );
}

async function callTool(
  name: string,
  params: Record<string, unknown>,
  executor: ReadOnlyExecutor,
): Promise<JsonRpcOutcome> {
  const text = (r: { stdout: string }): { content: { type: "text"; text: string }[] } => ({
    content: [{ type: "text", text: r.stdout }],
  });

  try {
    switch (name) {
      case "system_snapshot": {
        const sections = await snapshotSections(executor);
        return { result: { content: [{ type: "text", text: sections.join("\n\n") }] } };
      }
      case "process_tree":
        return { result: text(await executor("ps", ["aux", "--forest"])) };
      case "net_connections":
        return { result: text(await executor("ss", ["-tulnp"])) };
      case "service_status": {
        const service = str(params.service);
        if (!service || !UNIT_NAME.test(service))
          return { error: error(-32602, "service must be a valid systemd unit name") };
        return { result: text(await executor("systemctl", ["status", service, "--no-pager", "--lines=40"])) };
      }
      case "journal_logs": {
        const unit = str(params.unit);
        if (!unit || !UNIT_NAME.test(unit))
          return { error: error(-32602, "unit must be a valid systemd unit name") };
        const since = str(params.since) ?? "1 hour ago";
        const lines =
          typeof params.lines === "number" &&
          Number.isInteger(params.lines) &&
          params.lines > 0 &&
          params.lines <= 1000
            ? params.lines
            : 100;
        return {
          result: text(await executor("journalctl", ["-u", unit, "--since", since, "-n", String(lines), "--no-pager"])),
        };
      }
      case "file_read": {
        const path = str(params.path);
        if (!path || path.includes(".."))
          return { error: error(-32602, "file_read path must not contain '..'") };
        // Resolve symlinks before the allowlist check to block symlink-traversal.
        // Use /dev/fd/ to open a file descriptor at check time so the path
        // cannot be swapped out between the allowlist check and the read (TOCTOU).
        let resolved: string;
        let fd: number;
        try {
          resolved = realpathSync(path);
          fd = openSync(resolved, "r");
        } catch {
          return { error: error(-32602, "file_read: path does not exist or is inaccessible") };
        }
        const allowed = ALLOWED_READ_PREFIXES.some((p) => resolved.startsWith(p));
        if (!allowed) {
          closeSync(fd);
          return { error: error(-32602, `file_read path must be under: ${ALLOWED_READ_PREFIXES.join(", ")}`) };
        }
        try {
          return { result: text(await executor("cat", [`/dev/fd/${fd}`])) };
        } finally {
          closeSync(fd);
        }
      }
      case "dns_lookup": {
        const hostname = str(params.hostname);
        if (!hostname || !HOSTNAME.test(hostname))
          return { error: error(-32602, "hostname must be a valid DNS name") };
        return { result: text(await executor("getent", ["hosts", hostname])) };
      }
      default:
        return { error: error(-32003, `unknown tool: ${name}`) };
    }
  } catch (err) {
    // ExecError carries stderr worth showing; anything else is an internal tool failure.
    const e = err as ExecError;
    const message = e && typeof e === "object" && "stderr" in e && e.stderr.trim()
      ? `${e.message}: ${e.stderr.trim()}`
      : err instanceof Error
        ? err.message
        : String(err);
    return { error: error(-32002, message) };
  }
}

function challenge(
  msg: { id?: unknown; method: string; params?: unknown },
  executor: ReadOnlyExecutor,
): Promise<JsonRpcOutcome> {
  const params = (msg.params ?? {}) as Record<string, unknown>;
  switch (msg.method) {
    case "initialize":
      return Promise.resolve({
        result: {
          protocolVersion:
            typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: LOCAL_MCP_NAME, version: SERVER_VERSION },
        },
      });
    case "ping":
      return Promise.resolve({ result: {} });
    case "tools/list":
      return Promise.resolve({ result: { tools: TOOLS } });
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string")
        return Promise.resolve({ error: error(-32602, "tools/call requires a string 'name'") });
      const rawArgs = params.arguments;
      if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs)))
        return Promise.resolve({ error: error(-32602, "'arguments' must be a JSON object") });
      const paramsObj = (rawArgs as Record<string, unknown> | null) ?? {};
      // Params not meant for this command's tool are ignored (all inputs are
      // allowlisted/validated per tool); no `name`/`arguments` leak into args.
      return callTool(name, paramsObj, executor);
    }
    default:
      return Promise.resolve({ error: error(-32601, `Method not found: ${msg.method}`) });
  }
}

/**
 * Minimal MCP-over-HTTP JSON-RPC endpoint at POST /mcp (5b). Implements
 * initialize / tools/list / tools/call / ping; notifications (no `id`) are
 * acknowledged, not answered. Errors come back as JSON-RPC error objects, not
 * 500s.
 * ponytail: single POST endpoint only — no streamable-HTTP SSE GET or session
 * keepalive; add those if TrueForge's remote-connector client requires them.
 */
export interface McpRouterOptions {
  executor?: ReadOnlyExecutor;
}

export function createMcpRouter(opts: McpRouterOptions = {}): Router {
  const executor = opts.executor ?? execReadOnly;
  const router = Router();

  router.post("/mcp", (req: Request, res: Response) => {
    const body = req.body;
    if (typeof body !== "object" || body === null || typeof (body as { method?: unknown }).method !== "string") {
      res.status(400).json({ jsonrpc: "2.0", id: null, error: error(-32600, "Invalid Request") });
      return;
    }
    const msg = body as { id?: unknown; method: string; params?: unknown };
    if (msg.id === undefined || msg.id === null) {
      res.status(202).end(); // notification — no reply expected
      return;
    }
    void challenge(msg, executor).then((outcome) => {
      if ("error" in outcome) res.json({ jsonrpc: "2.0", id: msg.id, error: outcome.error });
      else res.json({ jsonrpc: "2.0", id: msg.id, result: outcome.result });
    });
  });

  return router;
}
