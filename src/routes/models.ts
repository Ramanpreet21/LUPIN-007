import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";
import type { TrueForgeHandle } from "../trueforge";

export interface ModelsRouterOptions {
  getTf?: () => TrueForgeHandle;
  logger?: Logger;
}

export const TRUEFORGE_MODEL_CATALOG = [
  // Google Gemini (Active in running TrueForge)
  { id: "google-gemini/gemini-3-6-flash", name: "Gemini 3.6 Flash", provider: "Google Gemini" },
  { id: "google-gemini/gemini-3-1-pro-preview", name: "Gemini 3.1 Pro Preview", provider: "Google Gemini" },

  // Anthropic Claude
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", provider: "Anthropic" },
  { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "Anthropic" },
  { id: "anthropic/claude-opus-5", name: "Claude Opus 5", provider: "Anthropic" },
  { id: "anthropic/claude-opus-4-8", name: "Claude Opus 4.8", provider: "Anthropic" },
  { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "Anthropic" },
  { id: "anthropic/claude-fable-5", name: "Claude Fable 5", provider: "Anthropic" },

  // OpenAI
  { id: "openai/gpt-5-6-terra", name: "GPT-5.6 Terra", provider: "OpenAI" },
  { id: "openai/gpt-5-6-sol", name: "GPT-5.6 Sol", provider: "OpenAI" },
  { id: "openai/gpt-5-6-luna", name: "GPT-5.6 Luna", provider: "OpenAI" },
  { id: "openai/gpt-5-5", name: "GPT-5.5", provider: "OpenAI" },
  { id: "openai/gpt-5-4-mini", name: "GPT-5.4 Mini", provider: "OpenAI" },

  // Fireworks / DeepSeek / Kimi / MiniMax
  { id: "fireworks/deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "Fireworks" },
  { id: "fireworks/kimi-k3", name: "Kimi K3", provider: "Fireworks" },
  { id: "fireworks/glm-5p2", name: "GLM-5.2", provider: "Fireworks" },
  { id: "fireworks/minimax-m3", name: "MiniMax M3", provider: "Fireworks" },

  // Alibaba Qwen
  { id: "alibaba/qwen3-8-max", name: "Qwen 3.8 Max", provider: "Alibaba" },
  { id: "alibaba/qwen3-7-max", name: "Qwen 3.7 Max", provider: "Alibaba" },
  { id: "alibaba/qwen3-7-plus", name: "Qwen 3.7 Plus", provider: "Alibaba" },
  { id: "alibaba/qwen3-7-flash", name: "Qwen 3.7 Flash", provider: "Alibaba" },

  // Zhipu AI / ZAI
  { id: "zai/glm-5-2", name: "GLM 5.2", provider: "Zhipu AI" },
  { id: "zai/glm-5-turbo", name: "GLM 5 Turbo", provider: "Zhipu AI" },

  // Moonshot
  { id: "moonshot/kimi-k3", name: "Kimi K3", provider: "Moonshot" },
  { id: "moonshot/kimi-k2-7-code", name: "Kimi K2.7 Code", provider: "Moonshot" },

  // Local / Custom
  { id: "local", name: "Local Model (Ollama / vLLM)", provider: "Local" },
];

export function createModelsRouter(opts?: ModelsRouterOptions): Router {
  const router = Router();
  const getTf = opts?.getTf;

  router.get("/api/models", async (_req: Request, res: Response) => {
    const db = getDb();
    const activeSetting = db.prepare("SELECT value FROM settings WHERE key = 'model'").get() as { value: string } | undefined;
    let active = activeSetting?.value ?? "google-gemini/gemini-3-6-flash";

    let modelsList = [...TRUEFORGE_MODEL_CATALOG];

    const tf = getTf?.();
    if (tf?.client && tf.status.state === "ready") {
      try {
        const live = await tf.client.models.list();
        if (Array.isArray(live?.data) && live.data.length > 0) {
          const liveIds = new Set(live.data.map((m: any) => m.name));
          const liveModels = live.data.map((m: any) => ({
            id: m.name,
            name: m.model_id || m.name,
            provider: `${m.provider?.name || "TrueForge"} (Configured)`,
          }));

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

    res.json({ data: modelsList, active });
  });

  return router;
}
