import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";

export type SandboxSettingsStatus = "unconfigured" | "pending" | "ready" | "error";

export interface SandboxSettings {
  configured: boolean;
  status: SandboxSettingsStatus;
  errorReason?: string;
}

/** Structural view of `client.settings.sandboxProviders` (SDK 0.1.3), so the
 * settings store is testable with a stub instead of the live SDK client. */
export interface SandboxProviderClient {
  get(): Promise<{ data: { status: string; statusReason: string | null } }>;
  createOrUpdate(request: {
    manifest: TrueForgeApi.SandboxProviderManifest;
  }): Promise<unknown>;
}

/** Shipped sandbox catalog provider presets from @truefoundry/trueforge. */
export const TRUEFORGE_SANDBOX_CATALOG = [
  {
    type: "daytona",
    name: "Daytona Cloud (TrueForge Native)",
    description: "Cloud-hosted isolated execution microVMs with fast snapshots and auto-stop.",
    defaultAutoStopMinutes: 30,
    defaultAutoArchiveMinutes: 60,
    defaultAutoDeleteMinutes: 1440,
    defaultExecTimeoutMs: 300000,
    requiresApiKey: true,
    requiresServerUrl: false,
  },
  {
    type: "daytona-custom",
    name: "Daytona Dedicated / Self-Hosted",
    description: "Private Daytona server deployment for on-prem or VPC isolated sandbox execution.",
    defaultAutoStopMinutes: 30,
    defaultAutoArchiveMinutes: 60,
    defaultAutoDeleteMinutes: 1440,
    defaultExecTimeoutMs: 300000,
    requiresApiKey: true,
    requiresServerUrl: true,
  },
  {
    type: "podman",
    name: "Local Podman Container",
    description: "Rootless local Podman container runtime for sandboxed CLI execution on the host.",
    defaultAutoStopMinutes: 0,
    defaultAutoArchiveMinutes: 0,
    defaultAutoDeleteMinutes: 0,
    defaultExecTimeoutMs: 60000,
    requiresApiKey: false,
    requiresServerUrl: false,
  },
  {
    type: "docker",
    name: "Local Docker Container",
    description: "Local Docker socket container runtime for isolated testing and remediation.",
    defaultAutoStopMinutes: 0,
    defaultAutoArchiveMinutes: 0,
    defaultAutoDeleteMinutes: 0,
    defaultExecTimeoutMs: 60000,
    requiresApiKey: false,
    requiresServerUrl: false,
  },
  {
    type: "isolated-local",
    name: "Simulated Isolated Host Process",
    description: "Protected subprocess isolation on the host system.",
    defaultAutoStopMinutes: 0,
    defaultAutoArchiveMinutes: 0,
    defaultAutoDeleteMinutes: 0,
    defaultExecTimeoutMs: 30000,
    requiresApiKey: false,
    requiresServerUrl: false,
  },
] as const;

/**
 * Daytona presets hardcoded by the control plane (PR #4 4a). The operator only
 * supplies the API key; the control plane owns the lifecycle tuning.
 */
const DAYTONA_PRESETS = {
  type: "daytona",
  autoStopIntervalInMinutes: 30,
  autoArchiveIntervalInMinutes: 60,
  autoDeleteIntervalInMinutes: 1440, // 24h
  execTimeoutMs: 300000, // 5 min
} as const;

/** An unconfigured provider surfaces as a 404 from the SDK's `get()`. */
function isUnconfiguredError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { statusCode?: unknown; name?: unknown; message?: unknown };
  if (e.statusCode === 404) return true;
  if (e.name === "NotFoundError") return true;
  return typeof e.message === "string" && /not found/i.test(e.message);
}

/**
 * Current sandbox setup. The provider is the source of truth: `unconfigured`
 * until one is configured; otherwise its live status drives the result.
 */
export async function getSandboxSettings(
  client: SandboxProviderClient | null,
): Promise<SandboxSettings> {
  if (client === null) {
    return { configured: false, status: "unconfigured" };
  }
  let provider: { data: { status: string; statusReason: string | null } };
  try {
    provider = await client.get();
  } catch (err) {
    if (isUnconfiguredError(err)) return { configured: false, status: "unconfigured" };
    throw err; // surfaced by the route as a 500
  }
  const { status, statusReason } = provider.data;
  if (status === "ready") return { configured: true, status: "ready" };
  if (status === "failed") {
    return {
      configured: true,
      status: "error",
      ...(statusReason ? { errorReason: statusReason } : {}),
    };
  }
  return { configured: true, status: "pending" };
}

let daytonaApiKeyStore: string | undefined = undefined;

export function setDaytonaApiKey(key: string): void {
  daytonaApiKeyStore = key;
}

export function getDaytonaApiKey(): string | undefined {
  return daytonaApiKeyStore;
}

export function resetSandboxSettings(): void {
  daytonaApiKeyStore = undefined;
}

/**
 * Configure the TrueForge sandbox provider with the operator's Daytona API key.
 * The provider is the source of truth for the settings; a bad key is rejected
 * by the provider (400) before anything changes.
 */
export async function updateSandboxSettings(
  client: SandboxProviderClient,
  apiKey: string,
  serverUrl?: string,
): Promise<SandboxSettings> {
  const manifest: Record<string, unknown> = {
    ...DAYTONA_PRESETS,
    auth: { apiKey },
  };
  if (serverUrl) {
    manifest.serverUrl = serverUrl;
  }
  await client.createOrUpdate({
    manifest: manifest as unknown as TrueForgeApi.SandboxProviderManifest,
  });
  setDaytonaApiKey(apiKey);
  return getSandboxSettings(client);
}

