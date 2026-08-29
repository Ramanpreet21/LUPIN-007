import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import type { TrueForgeHandle } from "../trueforge";
import { getSandboxSettings, updateSandboxSettings } from "../sandbox-settings";

export interface SandboxRouterOptions {
  /** Returns the current TrueForge handle so status is live per request. */
  getTf: () => TrueForgeHandle;
  logger: Logger;
}

/**
 * Sandbox setup routes: GET /api/settings/sandbox (current setup) and
 * PUT /api/settings/sandbox (store the operator's Daytona API key + configure
 * the TrueForge sandbox provider on their behalf).
 */
export function createSandboxRouter({ getTf, logger }: SandboxRouterOptions): Router {
  const router = Router();

  router.get("/api/settings/sandbox", async (_req: Request, res: Response) => {
    try {
      // No provider client (TrueForge unconfigured) reads as unconfigured.
      res.json(await getSandboxSettings(getTf().client?.settings.sandboxProviders ?? null));
    } catch (err) {
      logger.error({ event: "sandbox_settings_get_failed", err }, "failed to read sandbox settings");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.put("/api/settings/sandbox", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const apiKey = body.apiKey;
    if (typeof apiKey !== "string" || apiKey.trim() === "") {
      res.status(400).json({ error: "invalid_payload", details: ["apiKey must be a non-empty string"] });
      return;
    }
    const client = getTf().client;
    if (!client) {
      res.status(503).json({ error: "trueforge_unconfigured" });
      return;
    }
    try {
      res.json(await updateSandboxSettings(client.settings.sandboxProviders, apiKey));
    } catch (err) {
      // A provider-side rejection (bad key, missing permission) is the operator's
      // input to fix — surface it as a 400, not an internal error.
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
    }
  });

  return router;
}
