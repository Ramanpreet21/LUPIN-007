import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";
import type { TrueForgeHandle } from "../trueforge";

export interface ModelsRouterOptions {
  getTf?: () => TrueForgeHandle;
  logger?: Logger;
}

const FALLBACK_MODELS = [
  { id: "google-gemini/gemini-3-6-flash", name: "Gemini 3.6 Flash", provider: "Google" },
  { id: "google-gemini/gemini-3-1-pro-preview", name: "Gemini 3.1 Pro Preview", provider: "Google" },
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", provider: "Anthropic" },
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "local", name: "Local Model", provider: "Local" },
];

export function createModelsRouter(opts?: ModelsRouterOptions): Router {
  const router = Router();
  const getTf = opts?.getTf;

  router.get("/api/models", async (_req: Request, res: Response) => {
    const db = getDb();
    const activeSetting = db.prepare("SELECT value FROM settings WHERE key = 'model'").get() as { value: string } | undefined;
    let active = activeSetting?.value ?? "google-gemini/gemini-3-6-flash";

    let modelsList = [...FALLBACK_MODELS];

    const tf = getTf?.();
    if (tf?.client && tf.status.state === "ready") {
      try {
        const live = await tf.client.models.list();
        if (Array.isArray(live?.data) && live.data.length > 0) {
          modelsList = live.data.map((m: any) => ({
            id: m.name,
            name: m.model_id || m.name,
            provider: m.provider?.name || "TrueForge",
          }));
          if (!activeSetting?.value || !modelsList.some((m) => m.id === active)) {
            active = modelsList[0].id;
          }
        }
      } catch {
        /* fallback to known list */
      }
    }

    res.json({ data: modelsList, active });
  });

  return router;
}
