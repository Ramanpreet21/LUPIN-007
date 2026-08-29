import type { TrueForgeHandle } from "./trueforge";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import type { Logger } from "./logger";
import { LOCAL_MCP_NAME } from "./mcp-provider";
import { getModelApiKey } from "./model-settings";

export interface TrueForgeSetupOptions {
  getTf: () => TrueForgeHandle;
  logger: Logger;
  /** Model FQN (`provider/model`) used by incident sessions. */
  model: string;
  /** Reachable URL of the local MCP provider, e.g. http://127.0.0.1:3000/mcp. */
  mcpUrl: string;
}

/**
 * TrueForge auto-setup (5a, Model B): run once after the server listens so a
 * one-command boot self-configures. Every step no-ops with a warning on
 * failure; a dead TrueForge server or a missing key must never block startup
 * (the existing /alerts 503 still reports the problem later).
 */
export async function runTrueForgeSetup(opts: TrueForgeSetupOptions): Promise<void> {
  const { getTf, logger, model, mcpUrl } = opts;
  const client = getTf().client;
  if (!client) {
    logger.warn({ event: "trueforge_setup_skipped", step: "no_client" }, "TrueForge setup skipped (no client)");
    return;
  }
  const warn = (step: string, err: unknown): void => {
    logger.warn(
      { event: "trueforge_setup_skipped", step, err: err instanceof Error ? err.message : String(err) },
      `TrueForge setup skipped: ${step}`,
    );
  };

  // 1. Readiness probe — the server must answer before we mutate settings.
  try {
    await client.server.getCapabilities();
  } catch (err) {
    warn("capabilities", err);
    return;
  }

  // 2. Anthropic model provider — only when a stored key exists and the
  //    well-known `type` isn't configured yet. Key missing → skip, warn, proceed.
  const apiKey = getModelApiKey();
  if (apiKey) {
    try {
      const { data } = await client.settings.modelProviders.list();
      const items = Array.isArray(data) ? data : [];
      const hasAnthropic = items.some(
        (p) => (p as { name?: string; type?: string }).name === "anthropic"
          || (p as { name?: string; type?: string }).type === "anthropic",
      );
      if (!hasAnthropic) {
        const slash = model.indexOf("/");
        const provider = slash >= 0 ? model.slice(0, slash) : model;
        const modelId = slash >= 0 ? model.slice(slash + 1) : model;
        try {
          const { data } = await client.settings.modelProviders.list();
          const items = Array.isArray(data) ? data : [];
          // Derive the expected provider type from TRUEFORGE_MODEL so we check for
          // the right type — not a hardcoded "anthropic" (finding #2).
          const expectedType = provider;
          const hasProvider = items.some(
            (p) => (p as { name?: string; type?: string }).name === expectedType
              || (p as { name?: string; type?: string }).type === expectedType,
          );
          if (!hasProvider) {
            const manifest = {
              type: provider,
              auth: { apiKey },
              models: [{ modelId, name: model, properties: {} }],
            } as TrueForgeApi.ModelProviderManifest;
            await client.settings.modelProviders.createOrUpdate({ manifest });
            logger.info(
              { event: "trueforge_setup", step: "model_provider", provider, modelId },
              "model provider configured",
            );
          }
        } catch (err) {
          warn("model_provider", err);
        }
      }
    } catch (err) {
      warn("model_provider", err);
    }
  } else {
    logger.warn(
      { event: "trueforge_setup_skipped", step: "model_provider_no_key" },
      "model provider not configured (no API key stored)",
    );
  }

  // 3. Register the local read-only MCP connector. The registry manifest holds
  //    no approval selectors — enableTools/requireApprovalForTools live on the
  //    per-session McpServer entry (incident-plane.ts runDiagnosis), keeping the
  //    approve-before-run property server-side for any future write tool.
  try {
    await client.settings.mcpServers.createOrUpdate({
      manifest: {
        name: LOCAL_MCP_NAME,
        description: "Incident Command Deck local read-only diagnostic tools",
        type: "remote",
        url: mcpUrl,
      },
    });
    logger.info(
      { event: "trueforge_setup", step: "mcp_connector", name: LOCAL_MCP_NAME, url: mcpUrl },
      "MCP connector configured",
    );
  } catch (err) {
    warn("mcp_connector", err);
  }
}
