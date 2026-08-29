import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getModelSettings, updateModelSettings } from "../model-settings";

export interface ModelRouterOptions {
  logger: Logger;
}

/**
 * Model settings routes (5a): GET /api/settings/model reports whether an
 * Anthropic key is configured (never the key itself); PUT stores the operator's
 * key in memory for trueforge-setup to consume at the next boot.
 */
export function createModelRouter({ logger }: ModelRouterOptions): Router {
  const router = Router();

  router.get("/api/settings/model", (_req: Request, res: Response) => {
    res.json(getModelSettings());
  });

  router.put("/api/settings/model", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const apiKey = body.apiKey;
    if (typeof apiKey !== "string" || apiKey.trim() === "") {
      res.status(400).json({ error: "invalid_payload", details: ["apiKey must be a non-empty string"] });
      return;
    }
    updateModelSettings(apiKey.trim());
    res.json({ ok: true, ...getModelSettings() });
    logger.info({ event: "model_settings_updated" }, "model provider key stored");
  });

  return router;
}
