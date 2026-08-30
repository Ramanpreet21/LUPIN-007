import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";

export interface ModelsRouterOptions {
  logger?: Logger;
}

const KNOWN_MODELS = [
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", provider: "Anthropic" },
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "Google" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google" },
  { id: "local", name: "Local Model", provider: "Local" },
];

export function createModelsRouter(opts?: ModelsRouterOptions): Router {
  const router = Router();

  router.get("/api/models", (_req: Request, res: Response) => {
    const db = getDb();
    const activeSetting = db.prepare("SELECT value FROM settings WHERE key = 'model'").get() as { value: string } | undefined;
    const active = activeSetting?.value ?? "anthropic/claude-sonnet-5";
    res.json({ data: KNOWN_MODELS, active });
  });

  return router;
}
