import { Router, type Request, type Response } from "express";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import type { Logger } from "../logger";
import type { TrueForgeHandle } from "../trueforge";
import { getModelSettings, updateModelSettings } from "../model-settings";

export interface ModelRouterOptions {
  logger: Logger;
  /** Set at app bootstrap; null when TrueForge is unconfigured. */
  getTf: () => TrueForgeHandle;
  /** Model FQN (`provider/model`) from config, used to name the provider manifest. */
  model: string;
}

/**
 * Model settings routes (5a): GET /api/settings/model reports whether an
 * key is configured (never the key itself); PUT stores the operator's
 * key in memory and immediately creates the TrueForge model provider so
 * subsequent incident sessions can resolve the model without a restart.
 */
export function createModelRouter({ logger, getTf, model }: ModelRouterOptions): Router {
  const router = Router();

  router.get("/api/settings/model", (_req: Request, res: Response) => {
    res.json(getModelSettings());
  });

  router.put("/api/settings/model", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const apiKey = body.apiKey;
    if (typeof apiKey !== "string" || apiKey.trim() === "") {
      res.status(400).json({ error: "invalid_payload", details: ["apiKey must be a non-empty string"] });
      return;
    }
    updateModelSettings(apiKey.trim());
    logger.info({ event: "model_settings_updated" }, "model provider key stored");

    // Immediately create the provider so it's available for the next incident
    // without requiring a restart. Finding #1: model key was stored but never applied.
    const tf = getTf();
    if (tf.client) {
      const slash = model.indexOf("/");
      const provider = slash >= 0 ? model.slice(0, slash) : model;
      const modelId = slash >= 0 ? model.slice(slash + 1) : model;
      try {
        const { data } = await tf.client.settings.modelProviders.list();
        const items = Array.isArray(data) ? data : [];
        const expectedType = provider;
        const hasProvider = items.some(
          (p) => (p as { name?: string; type?: string }).name === expectedType
            || (p as { name?: string; type?: string }).type === expectedType,
        );
        if (!hasProvider) {
          const manifest = {
            type: provider,
            auth: { apiKey: apiKey.trim() },
            models: [{ modelId, name: model, properties: {} }],
          } as TrueForgeApi.ModelProviderManifest;
          await tf.client.settings.modelProviders.createOrUpdate({ manifest });
          logger.info({ event: "model_provider_created", provider, modelId }, "model provider created");
        }
      } catch (err) {
        logger.warn({ event: "model_provider_create_failed", err }, "could not create model provider");
      }
    }

    res.json({ ok: true, ...getModelSettings() });
  });

  return router;
}
