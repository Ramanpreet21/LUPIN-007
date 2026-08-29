import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import type { TrueForgeHandle } from "../trueforge";
import { getModelSettings, updateModelSettings } from "../model-settings";

export interface ModelRouterOptions {
  logger: Logger;
  /** Set at app bootstrap; null when TrueForge is unconfigured. */
  getTf: () => TrueForgeHandle;
  /** Model FQN (`provider/model`) from config, used to name the provider manifest. */
  model: string;
  /** Bearer token for the settings API. When set, all mutating endpoints require it. */
  apiToken?: string;
}

/**
 * Middleware: validates Authorization: Bearer <token> on sensitive settings routes.
 * Returns 401 if a token is configured but the request has no matching header.
 */
function requireApiToken(token: string | undefined) {
  return (req: Request, res: Response, next: () => void): void => {
    if (!token) { next(); return; }
    const header = (req.headers["authorization"] ?? "") as string;
    const match = header.toLowerCase().startsWith("bearer ");
    if (!match || header.slice(7).trim() !== token) {
      res.status(401).json({ error: "unauthorized", details: ["Valid Authorization header required."] });
      return;
    }
    next();
  };
}

/**
 * Model settings routes (5a): GET /api/settings/model reports whether an
 * key is configured (never the key itself); PUT stores the operator's
 * key in memory and immediately creates the TrueForge model provider so
 * subsequent incident sessions can resolve the model without a restart.
 */
export function createModelRouter({ logger, getTf, model, apiToken }: ModelRouterOptions): Router {
  const router = Router();

  router.get("/api/settings/model", (_req: Request, res: Response) => {
    res.json(getModelSettings());
  });

  router.put("/api/settings/model", requireApiToken(apiToken), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const apiKey = body.apiKey;
    if (typeof apiKey !== "string" || apiKey.trim() === "") {
      res.status(400).json({ error: "invalid_payload", details: ["apiKey must be a non-empty string"] });
      return;
    }
    updateModelSettings(apiKey.trim());
    logger.info({ event: "model_settings_updated" }, "model provider key stored");

    // Immediately upsert the provider so it's available for the next incident
    // without requiring a restart. Finding #1: model key was stored but never applied.
    const tf = getTf();
    if (!tf.client) {
      res.status(503).json({
        error: "trueforge_unavailable",
        details: ["TrueForge is not configured — cannot sync provider. Check TRUEFORGE_BASE_URL."],
      });
      return;
    }

    const slash = model.indexOf("/");
    const provider = slash >= 0 ? model.slice(0, slash) : model;
    const modelId = slash >= 0 ? model.slice(slash + 1) : model;
    try {
      const manifest = {
        type: provider,
        auth: { apiKey: apiKey.trim() },
        models: [{ modelId, name: model, properties: {} }],
      };
      // Cast via variable to avoid TS narrowing on the `provider` variable
      // (type: string not assignable to "zai"). `unknown` breaks the chain.
      const req: unknown = manifest;
      await tf.client.settings.modelProviders.createOrUpdate(req as Parameters<typeof tf.client.settings.modelProviders.createOrUpdate>[0]);
      logger.info({ event: "model_provider_updated", provider, modelId }, "model provider updated");
    } catch (err) {
      logger.warn({ event: "model_provider_upsert_failed", err }, "could not upsert model provider");
      res.status(502).json({
        error: "provider_sync_failed",
        details: [err instanceof Error ? err.message : String(err)],
      });
      return;
    }

    res.json({ ok: true, ...getModelSettings() });
  });

  return router;
}
