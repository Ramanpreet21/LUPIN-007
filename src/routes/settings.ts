import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";

export interface SettingsRouterOptions {
  logger?: Logger;
  broadcast?: (message: unknown) => void;
}

const ALLOWED_KEYS = new Set([
  "enforcement_mode",
  "model",
  "model_provider",
  "model_api_key",
  "configured_providers",
  "sandbox_provider",
  "sandbox_url",
  "sandbox_key",
  "openai_api_key",
  "anthropic_api_key",
  "gemini_api_key",
  "fireworks_api_key",
  "alibaba_api_key",
  "moonshot_api_key",
  "zai_api_key",
  "operator_name",
  "skills",
  "mcps",
]);

export function createSettingsRouter(opts?: SettingsRouterOptions): Router {
  const router = Router();
  const logger = opts?.logger;
  const broadcast = opts?.broadcast;

  router.get("/api/settings", (_req: Request, res: Response) => {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json(settings);
  });

  router.put("/api/settings", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const db = getDb();
    const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value");

    const updated: string[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      upsert.run({ key, value: strValue });
      updated.push(key);
    }

    if (updated.includes("enforcement_mode")) {
      broadcast?.({ type: "agent_mode_changed", payload: { mode: body.enforcement_mode } });
    }

    logger?.info({ event: "settings_updated", updated }, "settings updated");
    res.json({ status: "ok", updated });
  });

  return router;
}
