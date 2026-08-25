import { TrueForge } from "@truefoundry/trueforge-sdk";
import type { Logger } from "./logger";

export interface TrueForgeInitOptions {
  /** TrueForge Agent Harness Server base URL (required). */
  baseUrl?: string;
  /** Optional bearer token (ID token) for authed servers. */
  token?: string;
  timeoutInSeconds?: number;
  maxRetries?: number;
}

export type TrueForgeStatus =
  | { state: "ready"; baseUrlConfigured: boolean; authConfigured: boolean }
  | { state: "unconfigured"; missing: string[] }
  | { state: "failed"; error: string };

export interface TrueForgeHandle {
  client: TrueForge | null;
  status: TrueForgeStatus;
}

/**
 * Initialize the TrueForge SDK in isolation.
 *
 * Status reflects client *construction* only: no request is made to the
 * TrueForge server here. "ready" means the client was instantiated against
 * the configured base URL. Live connectivity probing and wiring of
 * session-stream events into the control plane is the PR #3 extension point
 * (`client.sessions.createTurnStream(...)` / `subscribeToTurn(...)`).
 */
export function initTrueForge(opts: TrueForgeInitOptions, logger: Logger): TrueForgeHandle {
  const missing: string[] = [];
  if (!opts.baseUrl) missing.push("TRUEFORGE_BASE_URL");

  if (missing.length > 0) {
    logger.warn({ event: "trueforge_unconfigured", missing }, "TrueForge SDK not initialized (missing config)");
    return { client: null, status: { state: "unconfigured", missing } };
  }

  try {
    const client = new TrueForge({
      baseUrl: opts.baseUrl as string,
      ...(opts.token ? { token: opts.token } : {}),
      ...(opts.timeoutInSeconds ? { timeoutInSeconds: opts.timeoutInSeconds } : {}),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    });
    logger.info(
      { event: "trueforge_initialized", baseUrl: opts.baseUrl, authConfigured: Boolean(opts.token) },
      "TrueForge SDK initialized",
    );
    return {
      client,
      status: { state: "ready", baseUrlConfigured: true, authConfigured: Boolean(opts.token) },
    };
  } catch (err) {
    logger.error({ event: "trueforge_init_failed", err }, "TrueForge SDK initialization failed");
    return {
      client: null,
      status: { state: "failed", error: err instanceof Error ? err.message : String(err) },
    };
  }
}
