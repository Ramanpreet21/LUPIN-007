import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import type { TrueForgeHandle } from "../trueforge";
import { getSandboxSettings, updateSandboxSettings } from "../sandbox-settings";
import { getSandboxManager } from "../sandboxes/manager";
import type { SandboxType } from "../sandboxes/types";
import { getDb } from "../db";

/**
 * TrueForge per-sandbox status path (5f). FLAGGED in the PR5 plan as
 * unconfirmed: PR4-scope noted no TrueForge API for per-sandbox metrics, so
 * today this usually 404s and the dashboard keeps fixture metrics. One
 * constant to repoint when the real endpoint exists.
 */
const SANDBOX_STATUS_PATH = "/v1/sandboxes/:sandboxId/status";

export interface SandboxRouterOptions {
  /** Returns the current TrueForge handle so status is live per request. */
  getTf: () => TrueForgeHandle;
  logger: Logger;
  broadcast?: (message: unknown) => void;
}

/**
 * Multi-Runtime Sandbox API Routes:
 * - GET /api/sandboxes/probes (auto-discovers all available sandbox runtimes)
 * - POST /api/sandboxes/probe/:type (tests specific runner with custom config)
 * - POST /api/sandboxes/exec (runs a test command in the active sandbox runtime)
 * - GET /api/settings/sandbox (retrieves current sandbox settings)
 * - PUT /api/settings/sandbox (persists and activates sandbox provider)
 */
export function createSandboxRouter({ getTf, logger, broadcast }: SandboxRouterOptions): Router {
  const router = Router();
  const manager = getSandboxManager();

  // 1. Concurrently probe all sandbox types
  router.get("/api/sandboxes/probes", async (_req: Request, res: Response) => {
    try {
      const result = await manager.probeAll();
      res.json(result);
    } catch (err) {
      logger.error({ event: "sandbox_probes_failed", err }, "failed to probe sandbox runtimes");
      res.status(500).json({ error: "internal_error" });
    }
  });

  // 2. Probe a specific sandbox type
  router.post("/api/sandboxes/probe/:type", async (req: Request, res: Response) => {
    const type = req.params.type as SandboxType;
    const body = (req.body ?? {}) as { socketPath?: string; serverUrl?: string; apiKey?: string };
    try {
      const runner = manager.getRunner(type);
      const probe = await runner.probe(body);
      res.json(probe);
    } catch (err) {
      logger.error({ event: "sandbox_probe_type_failed", type, err }, "failed to probe sandbox type");
      res.status(500).json({ error: "internal_error", details: [String(err)] });
    }
  });

  // 3. Test execution in active sandbox runtime
  router.post("/api/sandboxes/exec", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { command?: string; timeoutMs?: number };
    const command = body.command || "echo 'sandbox execution ok'";
    try {
      const result = await manager.execInActive(command, { timeoutMs: body.timeoutMs });
      res.json(result);
    } catch (err) {
      logger.error({ event: "sandbox_exec_failed", err }, "sandbox exec failed");
      res.status(500).json({ error: "sandbox_exec_failed", details: [String(err)] });
    }
  });

  // 4. Retrieve current sandbox settings
  router.get("/api/settings/sandbox", async (_req: Request, res: Response) => {
    try {
      const client = getTf().client;
      let activeProvider = "daytona";
      let activeUrl = "";

      try {
        const db = getDb();
        const activeProviderRow = db.prepare("SELECT value FROM settings WHERE key = 'sandbox_provider'").get() as { value?: string } | undefined;
        const activeUrlRow = db.prepare("SELECT value FROM settings WHERE key = 'sandbox_url'").get() as { value?: string } | undefined;
        if (activeProviderRow?.value) activeProvider = activeProviderRow.value;
        if (activeUrlRow?.value) activeUrl = activeUrlRow.value;
      } catch {
        // Fallback for isolated test environments
      }

      if (activeProvider === "daytona" || activeProvider === "daytona-custom") {
        if (!client) {
          res.json({ configured: false, status: "unconfigured" });
          return;
        }
        const tfSettings = await getSandboxSettings(client.settings.sandboxProviders);
        res.json({
          ...tfSettings,
          ...(activeUrl ? { serverUrl: activeUrl } : {}),
        });
        return;
      }

      // Local container or subprocess isolation is locally configured
      res.json({
        configured: true,
        status: "ready",
        provider: activeProvider,
        serverUrl: activeUrl,
      });
    } catch (err) {
      logger.error({ event: "sandbox_settings_get_failed", err }, "failed to read sandbox settings");
      res.status(500).json({ error: "internal_error" });
    }
  });

  // 5. Update / Configure active sandbox provider
  router.put("/api/settings/sandbox", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const providerType = (body.type as SandboxType) || (body.provider as SandboxType) || "daytona";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const serverUrl = typeof body.serverUrl === "string" ? body.serverUrl.trim() : "";

    // Require apiKey for Daytona Cloud or Dedicated
    if ((providerType === "daytona" || providerType === "daytona-custom" || !body.type) && !apiKey) {
      res.status(400).json({ error: "invalid_payload", details: ["apiKey must be a non-empty string"] });
      return;
    }

    const client = getTf().client;
    if ((providerType === "daytona" || providerType === "daytona-custom" || !body.type) && !client) {
      res.status(503).json({ error: "trueforge_unconfigured" });
      return;
    }

    try {
      const db = getDb();
      const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value");
      upsert.run({ key: "sandbox_provider", value: providerType });
      if (serverUrl) upsert.run({ key: "sandbox_url", value: serverUrl });
      if (apiKey) upsert.run({ key: "sandbox_key", value: apiKey });
    } catch {
      // Fallback for test stubs
    }

    broadcast?.({
      type: "sandbox_provider_changed",
      payload: { provider: providerType, serverUrl },
    });

    if (client && (providerType === "daytona" || providerType === "daytona-custom" || apiKey)) {
      try {
        const result = await updateSandboxSettings(client.settings.sandboxProviders, apiKey, serverUrl);
        res.json(result);
        return;
      } catch (err) {
        const statusCode =
          typeof err === "object" && err !== null
            ? (err as { statusCode?: unknown }).statusCode
            : undefined;
        if (statusCode === 400) {
          res.status(400).json({
            error: "sandbox_configure_failed",
            details: [err instanceof Error ? err.message : String(err)],
          });
          return;
        }
        logger.error({ event: "sandbox_configure_failed", err }, "failed to configure sandbox provider");
        res.status(500).json({ error: "internal_error" });
        return;
      }
    }

    res.json({ configured: true, status: "ready", provider: providerType });
  });

  // 5f: live per-sandbox status via the SDK's fetch() passthrough (auth-aware,
  // base-URL-resolving). Map only what the remote actually provides — never
  // invent numbers; the dashboard merges these over fixture data when
  // metricsAvailable is true.
  router.get("/api/sandbox/:id/status", async (req: Request, res: Response) => {
    const { id: sandboxId } = req.params as { id: string };
    const client = getTf().client;
    if (!client) {
      res.status(503).json({ error: "trueforge_unconfigured", sandbox_id: sandboxId, metricsAvailable: false });
      return;
    }
    try {
      const remote = await client.fetch(
        SANDBOX_STATUS_PATH.replace(":sandboxId", encodeURIComponent(sandboxId)),
        { method: "GET" },
      );
      if (!remote.ok) {
        res.status(503).json({
          error: "sandbox_status_unavailable",
          details: [`TrueForge returned HTTP ${remote.status}`],
          sandbox_id: sandboxId,
          metricsAvailable: false,
        });
        return;
      }
      const body = (await remote.json()) as Record<string, unknown>;
      res.json({
        sandbox_id: sandboxId,
        metricsAvailable: true,
        ...(typeof body.state === "string" ? { state: body.state } : {}),
        ...(typeof body.resourceLimits === "object" && body.resourceLimits !== null
          ? { resourceLimits: body.resourceLimits }
          : {}),
      });
    } catch (err) {
      logger.error({ event: "sandbox_status_fetch_failed", sandbox_id: sandboxId, err }, "sandbox status fetch failed");
      res.status(503).json({ error: "sandbox_status_unavailable", sandbox_id: sandboxId, metricsAvailable: false });
    }
  });
  return router;
}

