/**
 * In-memory Anthropic model-provider key store (5a). Mirrors the sandbox
 * settings flow: the operator supplies the key from FirstRunSetup and the
 * control plane keeps it in memory for `trueforge-setup` to consume — never
 * persisted to disk, never returned by routes.
 */

export interface ModelSettings {
  apiKeyConfigured: boolean;
}

interface ModelSettingsStore extends ModelSettings {
  apiKey?: string;
}

let store: ModelSettingsStore = { apiKeyConfigured: false };

/** Status view — the key itself is never exposed. */
export function getModelSettings(): ModelSettings {
  return { apiKeyConfigured: store.apiKeyConfigured };
}

export function updateModelSettings(apiKey: string): ModelSettings {
  store = { apiKeyConfigured: true, apiKey };
  return getModelSettings();
}

/** The stored key, for trueforge-setup only. Never leak through routes. */
export function getModelApiKey(): string | undefined {
  return store.apiKeyConfigured ? store.apiKey : undefined;
}

/** Reset the in-memory store. Used by tests; also a safe first-run no-op. */
export function resetModelSettings(): void {
  store = { apiKeyConfigured: false };
}
