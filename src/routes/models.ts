import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";
import type { TrueForgeHandle } from "../trueforge";

export interface ModelsRouterOptions {
  getTf?: () => TrueForgeHandle;
  logger?: Logger;
}

export interface TrueForgeProviderInfo {
  id: string;
  name: string;
  defaultModel: string;
  requiresApiKey: boolean;
}

export const TRUEFORGE_PROVIDERS: TrueForgeProviderInfo[] = [
  { id: "google-gemini", name: "Google Gemini", defaultModel: "google-gemini/gemini-3-6-flash", requiresApiKey: true },
  { id: "anthropic", name: "Anthropic Claude", defaultModel: "anthropic/claude-sonnet-5", requiresApiKey: true },
  { id: "openai", name: "OpenAI", defaultModel: "openai/gpt-5-6-terra", requiresApiKey: true },
  { id: "fireworks", name: "Fireworks", defaultModel: "fireworks/deepseek-v4-pro", requiresApiKey: true },
  { id: "alibaba", name: "Alibaba Qwen", defaultModel: "alibaba/qwen3-8-max", requiresApiKey: true },
  { id: "zai", name: "Zhipu AI", defaultModel: "zai/glm-5-2", requiresApiKey: true },
  { id: "moonshot", name: "Moonshot", defaultModel: "moonshot/kimi-k3", requiresApiKey: true },
  { id: "local", name: "Local Model (Ollama / vLLM)", defaultModel: "local", requiresApiKey: false },
];

export const TRUEFORGE_MODEL_CATALOG = [
  // Google Gemini (Active in running TrueForge)
  { id: "google-gemini/gemini-3-6-flash", name: "Gemini 3.6 Flash", provider: "Google Gemini", providerId: "google-gemini" },
  { id: "google-gemini/gemini-3-1-pro-preview", name: "Gemini 3.1 Pro Preview", provider: "Google Gemini", providerId: "google-gemini" },

  // Anthropic Claude
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", provider: "Anthropic", providerId: "anthropic" },
  { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "Anthropic", providerId: "anthropic" },
  { id: "anthropic/claude-opus-5", name: "Claude Opus 5", provider: "Anthropic", providerId: "anthropic" },
  { id: "anthropic/claude-opus-4-8", name: "Claude Opus 4.8", provider: "Anthropic", providerId: "anthropic" },
  { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "Anthropic", providerId: "anthropic" },
  { id: "anthropic/claude-fable-5", name: "Claude Fable 5", provider: "Anthropic", providerId: "anthropic" },

  // OpenAI
  { id: "openai/gpt-5-6-terra", name: "GPT-5.6 Terra", provider: "OpenAI", providerId: "openai" },
  { id: "openai/gpt-5-6-sol", name: "GPT-5.6 Sol", provider: "OpenAI", providerId: "openai" },
  { id: "openai/gpt-5-6-luna", name: "GPT-5.6 Luna", provider: "OpenAI", providerId: "openai" },
  { id: "openai/gpt-5-5", name: "GPT-5.5", provider: "OpenAI", providerId: "openai" },
  { id: "openai/gpt-5-4-mini", name: "GPT-5.4 Mini", provider: "OpenAI", providerId: "openai" },

  // Fireworks / DeepSeek / Kimi / MiniMax
  { id: "fireworks/deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "Fireworks", providerId: "fireworks" },
  { id: "fireworks/kimi-k3", name: "Kimi K3", provider: "Fireworks", providerId: "fireworks" },
  { id: "fireworks/glm-5p2", name: "GLM-5.2", provider: "Fireworks", providerId: "fireworks" },
  { id: "fireworks/minimax-m3", name: "MiniMax M3", provider: "Fireworks", providerId: "fireworks" },

  // Alibaba Qwen
  { id: "alibaba/qwen3-8-max", name: "Qwen 3.8 Max", provider: "Alibaba", providerId: "alibaba" },
  { id: "alibaba/qwen3-7-max", name: "Qwen 3.7 Max", provider: "Alibaba", providerId: "alibaba" },
  { id: "alibaba/qwen3-7-plus", name: "Qwen 3.7 Plus", provider: "Alibaba", providerId: "alibaba" },
  { id: "alibaba/qwen3-7-flash", name: "Qwen 3.7 Flash", provider: "Alibaba", providerId: "alibaba" },

  // Zhipu AI / ZAI
  { id: "zai/glm-5-2", name: "GLM 5.2", provider: "Zhipu AI", providerId: "zai" },
  { id: "zai/glm-5-turbo", name: "GLM 5 Turbo", provider: "Zhipu AI", providerId: "zai" },

  // Moonshot
  { id: "moonshot/kimi-k3", name: "Kimi K3", provider: "Moonshot", providerId: "moonshot" },
  { id: "moonshot/kimi-k2-7-code", name: "Kimi K2.7 Code", provider: "Moonshot", providerId: "moonshot" },

  // Local / Custom
  { id: "local", name: "Local Model (Ollama / vLLM)", provider: "Local", providerId: "local" },
];

export function createModelsRouter(opts?: ModelsRouterOptions): Router {
  const router = Router();
  const getTf = opts?.getTf;

  router.get("/api/models", async (_req: Request, res: Response) => {
    const db = getDb();
    const activeSetting = db.prepare("SELECT value FROM settings WHERE key = 'model'").get() as { value: string } | undefined;
    let active = activeSetting?.value ?? "google-gemini/gemini-3-6-flash";

    const configuredProviders = new Set<string>(["google-gemini"]);

    // Read stored provider API keys & configured list
    const settingsRows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    for (const row of settingsRows) {
      if (row.key === "configured_providers") {
        try {
          const list = JSON.parse(row.value);
          if (Array.isArray(list)) list.forEach((p) => configuredProviders.add(p));
        } catch { /* ignore */ }
      } else if (row.key === "model_provider" && row.value) {
        configuredProviders.add(row.value);
      } else if (row.key.endsWith("_api_key") && row.value?.trim() !== "") {
        const providerPrefix = row.key.replace("_api_key", "");
        configuredProviders.add(providerPrefix);
      }
    }

    let modelsList = [...TRUEFORGE_MODEL_CATALOG];

    const tf = getTf?.();
    if (tf?.client && tf.status.state === "ready") {
      try {
        const live = await tf.client.models.list();
        if (Array.isArray(live?.data) && live.data.length > 0) {
          const liveIds = new Set(live.data.map((m: any) => m.name));
          const liveModels = live.data.map((m: any) => {
            const providerName = m.provider?.name || "TrueForge";
            const providerId = m.name?.split("/")[0] || "google-gemini";
            configuredProviders.add(providerId);
            return {
              id: m.name,
              name: m.model_id || m.name,
              provider: `${providerName} (Configured)`,
              providerId,
            };
          });

          const remainingCatalog = TRUEFORGE_MODEL_CATALOG.filter((m) => !liveIds.has(m.id));
          modelsList = [...liveModels, ...remainingCatalog];

          if (!activeSetting?.value || !modelsList.some((m) => m.id === active)) {
            active = modelsList[0].id;
          }
        }
      } catch {
        /* fallback to catalog */
      }
    }

    res.json({
      data: modelsList,
      providers: TRUEFORGE_PROVIDERS,
      configuredProviders: Array.from(configuredProviders),
      active,
    });
  });

  return router;
}
