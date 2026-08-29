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

// Single global API key for the operator's sandbox provider (not per-tenant).
let currentApiKey: string | undefined;

/** An unconfigured provider surfaces as a 404 from the SDK's `get()`. */
function isUnconfiguredError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { statusCode?: unknown; name?: unknown; message?: unknown };
  if (e.statusCode === 404) return true;
  if (e.name === "NotFoundError") return true;
  return typeof e.message === "string" && /not found/i.test(e.message);
}

/**
 * Current sandbox setup. `unconfigured` until the operator supplies a key via
 * PUT; once configured, the live provider status drives pending/ready/error.
 */
export async function getSandboxSettings(
  client: SandboxProviderClient | null,
): Promise<SandboxSettings> {
  if (currentApiKey === undefined || client === null) {
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

/**
 * Configure the TrueForge sandbox provider with the operator's Daytona API key.
 * The key is stored locally only after the provider accepts it, so a rejected
 * key (400 at the provider) leaves the previous configuration intact.
 */
export async function updateSandboxSettings(
  client: SandboxProviderClient,
  apiKey: string,
): Promise<SandboxSettings> {
  await client.createOrUpdate({
    manifest: { ...DAYTONA_PRESETS, auth: { apiKey } },
  });
  currentApiKey = apiKey;
  return getSandboxSettings(client);
}
