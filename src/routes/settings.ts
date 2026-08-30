import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";
import type { TrueForgeHandle } from "../trueforge";
import type { TrueForge } from "@truefoundry/trueforge-sdk";

export interface SettingsRouterOptions {
  getTf?: () => TrueForgeHandle;
  logger?: Logger;
  broadcast?: (message: unknown) => void;
}

const ALLOWED_KEYS = new Set([
  "enforcement_mode",
  "model",
  "model_provider",
  "model_api_key",
  "model_base_url",
  "configured_providers",
  "sandbox_provider",
  "sandbox_url",
  "sandbox_key",
  "apiKey",
  "openai_api_key",
  "anthropic_api_key",
  "gemini_api_key",
  "google_gemini_api_key",
  "fireworks_api_key",
  "alibaba_api_key",
  "moonshot_api_key",
  "zai_api_key",
  "operator_name",
  "skills",
  "mcps",
]);

const WELL_KNOWN_MODELS: Record<string, Array<{ modelId: string; name: string }>> = {
  "google-gemini": [
    { modelId: "gemini-3.6-flash", name: "gemini-3.6-flash" },
    { modelId: "gemini-3.1-pro-preview", name: "gemini-3.1-pro-preview" },
    { modelId: "gemini-2.5-flash", name: "gemini-2.5-flash" },
    { modelId: "gemini-2.5-pro", name: "gemini-2.5-pro" },
  ],
  anthropic: [
    { modelId: "claude-sonnet-5", name: "claude-sonnet-5" },
    { modelId: "claude-sonnet-4-6", name: "claude-sonnet-4-6" },
    { modelId: "claude-opus-5", name: "claude-opus-5" },
    { modelId: "claude-opus-4-8", name: "claude-opus-4-8" },
    { modelId: "claude-haiku-4-5", name: "claude-haiku-4-5" },
  ],
  openai: [
    { modelId: "gpt-5-6-terra", name: "gpt-5-6-terra" },
    { modelId: "gpt-5-6-sol", name: "gpt-5-6-sol" },
    { modelId: "gpt-5-6-luna", name: "gpt-5-6-luna" },
    { modelId: "gpt-5-5", name: "gpt-5-5" },
    { modelId: "gpt-5-4-mini", name: "gpt-5-4-mini" },
  ],
  fireworks: [
    { modelId: "deepseek-v4-pro", name: "deepseek-v4-pro" },
    { modelId: "kimi-k3", name: "kimi-k3" },
    { modelId: "glm-5p2", name: "glm-5p2" },
    { modelId: "minimax-m3", name: "minimax-m3" },
  ],
  alibaba: [
    { modelId: "qwen3-8-max", name: "qwen3-8-max" },
    { modelId: "qwen3-7-max", name: "qwen3-7-max" },
    { modelId: "qwen3-7-plus", name: "qwen3-7-plus" },
    { modelId: "qwen3-7-flash", name: "qwen3-7-flash" },
  ],
  zai: [
    { modelId: "glm-5-2", name: "glm-5-2" },
    { modelId: "glm-5-turbo", name: "glm-5-turbo" },
  ],
  moonshot: [
    { modelId: "kimi-k3", name: "kimi-k3" },
    { modelId: "kimi-k2-7-code", name: "kimi-k2-7-code" },
  ],
};

async function syncModelProviderToTrueForge(
  client: TrueForge,
  providerType: string,
  apiKey: string,
  baseUrl?: string,
) {
  const models = WELL_KNOWN_MODELS[providerType] || [{ modelId: "default", name: "default" }];
  const manifest = {
    type: providerType as any,
    auth: { apiKey },
    ...(baseUrl ? { baseUrl } : {}),
    models: models.map((m) => ({
      modelId: m.modelId,
      name: m.name,
      properties: {},
    })),
  };

  await client.settings.modelProviders.createOrUpdate({
    manifest: manifest as any,
  });
}

export function createSettingsRouter(opts?: SettingsRouterOptions): Router {
  const router = Router();
  const getTf = opts?.getTf;
  const logger = opts?.logger;
  const broadcast = opts?.broadcast;

  router.get("/api/settings", (_req: Request, res: Response) => {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json(settings);
  });

  router.put("/api/settings", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // 1. If an API key was provided for an LLM provider, synchronize & validate with TrueForge model providers
    const client = getTf?.()?.client;
    if (client) {
      const providerKeyMappings: Array<{ provider: string; keyName: string }> = [
        { provider: "google-gemini", keyName: "google_gemini_api_key" },
        { provider: "google-gemini", keyName: "gemini_api_key" },
        { provider: "anthropic", keyName: "anthropic_api_key" },
        { provider: "openai", keyName: "openai_api_key" },
        { provider: "fireworks", keyName: "fireworks_api_key" },
        { provider: "alibaba", keyName: "alibaba_api_key" },
        { provider: "zai", keyName: "zai_api_key" },
        { provider: "moonshot", keyName: "moonshot_api_key" },
      ];

      for (const mapping of providerKeyMappings) {
        const keyVal = body[mapping.keyName];
        if (typeof keyVal === "string" && keyVal.trim().length > 0) {
          try {
            await syncModelProviderToTrueForge(
              client,
              mapping.provider,
              keyVal.trim(),
              typeof body.model_base_url === "string" ? body.model_base_url : undefined,
            );
            logger?.info({ event: "trueforge_model_provider_synced", provider: mapping.provider }, "model provider synced to TrueForge");
          } catch (err: unknown) {
            logger?.error({ event: "trueforge_model_provider_sync_failed", provider: mapping.provider, err }, "failed to sync model provider to TrueForge");
            const message = err instanceof Error ? err.message : String(err);
            res.status(400).json({
              error: "trueforge_model_provider_error",
              details: [message],
            });
            return;
          }
        }
      }

      if (body.model_provider && typeof body.model_api_key === "string" && body.model_api_key.trim().length > 0) {
        const providerName = String(body.model_provider);
        if (providerName !== "local") {
          try {
            await syncModelProviderToTrueForge(
              client,
              providerName,
              body.model_api_key.trim(),
              typeof body.model_base_url === "string" ? body.model_base_url : undefined,
            );
            logger?.info({ event: "trueforge_model_provider_synced", provider: providerName }, "model provider synced to TrueForge");
          } catch (err: unknown) {
            logger?.error({ event: "trueforge_model_provider_sync_failed", provider: providerName, err }, "failed to sync model provider to TrueForge");
            const message = err instanceof Error ? err.message : String(err);
            res.status(400).json({
              error: "trueforge_model_provider_error",
              details: [message],
            });
            return;
          }
        }
      }
    }

    // 2. Upsert into database
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
