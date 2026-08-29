export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  /** TrueForge harness base URL (e.g. http://localhost:8790). */
  trueforgeBaseUrl?: string;
  /** Auth token for TrueForge. */
  trueforgeToken?: string;
  /**
   * Control plane's externally reachable base URL.
   * When set, used as the MCP callback URL so TrueForge (even on a separate
   * host/container) can reach the /mcp endpoint. Example:
   *   http://cp.example.com  →  http://cp.example.com/mcp
   * If omitted the MCP URL is derived from bind address (same-host only).
   */
  controlPlaneUrl?: string;
  /**
   * Bearer token for the control plane's settings API.
   * Required on all mutating endpoints (/api/settings/model PUT).
   * The dashboard must send this as Authorization: Bearer <token>.
   */
  controlPlaneApiToken?: string;
  /** Model FQN (provider/model) used for sandbox-enabled incident sessions. */
  trueforgeModel: string;
}

export interface CliOptions {
  port?: number;
  host?: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_TRUEFORGE_MODEL = "anthropic/claude-sonnet-5";

/** Parse a port string/number. Returns undefined for missing or invalid values. */
export function parsePort(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) return undefined;
  return n;
}

/**
 * Load configuration from the environment, with CLI flags taking precedence
 * over env vars, which take precedence over defaults.
 */
export function loadConfig(env: NodeJS.ProcessEnv, cli: CliOptions = {}): AppConfig {
  const port = parsePort(cli.port ?? env.PORT) ?? DEFAULT_PORT;
  const host = cli.host ?? env.HOST ?? DEFAULT_HOST;
  const logLevel = (env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL).toLowerCase();
  return {
    host,
    port,
    logLevel,
    trueforgeBaseUrl: env.TRUEFORGE_BASE_URL || undefined,
    trueforgeToken: env.TRUEFORGE_TOKEN || undefined,
    controlPlaneUrl: env.CONTROL_PLANE_URL || undefined,
    controlPlaneApiToken: env.CONTROL_PLANE_API_TOKEN || undefined,
    trueforgeModel: env.TRUEFORGE_MODEL || DEFAULT_TRUEFORGE_MODEL,
  };
}
