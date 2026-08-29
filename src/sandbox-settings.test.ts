import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "./logger";
import { startServer } from "./server";
import { createSandboxRouter } from "./routes/sandbox";
import type { TrueForgeHandle } from "./trueforge";

const logger = createLogger("silent");

/**
 * Mutable stub for `client.settings.sandboxProviders` — tests drive the live
 * provider response/error by editing `state` between requests.
 */
interface ProviderState {
  data: { status: string; statusReason: string | null };
  error?: unknown;
  createError?: unknown;
  /** Flipped true by a successful PUT; before that the provider has no config. */
  configured?: boolean;
  createCalls: unknown[];
}

function makeSandboxHandle(state: ProviderState) {
  const provider = {
    get: async () => {
      if (state.error) throw state.error;
      // The provider is the source of truth: before a successful PUT it has no
      // configuration, which the SDK's get() surfaces as a NotFoundError (404).
      if (!state.configured) {
        throw Object.assign(new Error("sandbox provider not configured"), {
          statusCode: 404,
          name: "NotFoundError",
        });
      }
      return { data: state.data };
    },
    createOrUpdate: async (request: unknown) => {
      state.createCalls.push(request);
      if (state.createError) throw state.createError;
      state.configured = true;
      return { data: state.data };
    },
  };
  const handle = {
    status: { state: "ready", baseUrlConfigured: true, authConfigured: false },
    client: { settings: { sandboxProviders: provider } },
  } as unknown as TrueForgeHandle;
  return { handle, state };
}

async function withSandboxServer(state: ProviderState) {
  const { handle } = makeSandboxHandle(state);
  return startServer({
    host: "127.0.0.1",
    port: 0,
    logger,
    getStatus: () => handle.status,
    registerRoutes: (app, { broadcast }) => {
      void broadcast;
      app.use(createSandboxRouter({ getTf: () => handle, logger }));
    },
  });
}

const baseUrl = (port: number): string => `http://127.0.0.1:${port}`;

// Each test owns its provider stub; `configured` flips on a successful PUT, so
// tests are independent of each other and of any module-global state.

test("GET /api/settings/sandbox is unconfigured before any key is supplied", async () => {
  const state: ProviderState = { data: { status: "ready", statusReason: null }, createCalls: [] };
  const server = await withSandboxServer(state);
  try {
    const res = await fetch(`${baseUrl(server.port)}/api/settings/sandbox`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { configured: false, status: "unconfigured" });
  } finally {
    await server.close();
  }
});

test("GET /api/settings/sandbox is unconfigured when TrueForge is not configured", async () => {
  const handle = {
    status: { state: "unconfigured", missing: ["TRUEFORGE_BASE_URL"] },
    client: null,
  } as unknown as TrueForgeHandle;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    logger,
    getStatus: () => handle.status,
    registerRoutes: (app) => {
      app.use(createSandboxRouter({ getTf: () => handle, logger }));
    },
  });
  try {
    const res = await fetch(`${baseUrl(server.port)}/api/settings/sandbox`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { configured: false, status: "unconfigured" });
  } finally {
    await server.close();
  }
});

test("PUT /api/settings/sandbox with a valid key stores it and returns provider status", async () => {
  const state: ProviderState = { data: { status: "pending", statusReason: null }, createCalls: [] };
  const server = await withSandboxServer(state);
  try {
    const res = await fetch(`${baseUrl(server.port)}/api/settings/sandbox`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "daytona_test_key" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { configured: boolean; status: string };
    assert.equal(body.configured, true);
    assert.equal(body.status, "pending");
    // The control plane hardcodes the Daytona presets; the API key is the only input.
    assert.equal(state.createCalls.length, 1);
    const request = state.createCalls[0] as { manifest: Record<string, unknown> };
    assert.equal(request.manifest.type, "daytona");
    assert.deepEqual(request.manifest.auth, { apiKey: "daytona_test_key" });
    assert.equal(request.manifest.autoStopIntervalInMinutes, 30);
    assert.equal(request.manifest.autoArchiveIntervalInMinutes, 60);
    assert.equal(request.manifest.autoDeleteIntervalInMinutes, 1440);
    assert.equal(request.manifest.execTimeoutMs, 300000);
  } finally {
    await server.close();
  }
});

test("PUT /api/settings/sandbox with a provider-rejected key returns 400 with a message", async () => {
  const state: ProviderState = {
    data: { status: "failed", statusReason: "no quota" },
    createCalls: [],
    createError: Object.assign(new Error("invalid Daytona API key"), { statusCode: 400 }),
  };
  const server = await withSandboxServer(state);
  try {
    const res = await fetch(`${baseUrl(server.port)}/api/settings/sandbox`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "bad-key" }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; details: string[] };
    assert.equal(body.error, "sandbox_configure_failed");
    assert.ok(body.details[0]?.includes("invalid Daytona API key"));
  } finally {
    await server.close();
  }
});

test("PUT /api/settings/sandbox with a missing apiKey returns 400 invalid_payload", async () => {
  const state: ProviderState = { data: { status: "ready", statusReason: null }, createCalls: [] };
  const server = await withSandboxServer(state);
  try {
    const res = await fetch(`${baseUrl(server.port)}/api/settings/sandbox`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "invalid_payload");
    assert.equal(state.createCalls.length, 0); // rejected before any provider call
  } finally {
    await server.close();
  }
});

test("PUT /api/settings/sandbox without a TrueForge client returns 503", async () => {
  const handle = {
    status: { state: "unconfigured", missing: ["TRUEFORGE_BASE_URL"] },
    client: null,
  } as unknown as TrueForgeHandle;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    logger,
    getStatus: () => handle.status,
    registerRoutes: (app) => {
      app.use(createSandboxRouter({ getTf: () => handle, logger }));
    },
  });
  try {
    const res = await fetch(`${baseUrl(server.port)}/api/settings/sandbox`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "k" }),
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "trueforge_unconfigured");
  } finally {
    await server.close();
  }
});

test("GET /api/settings/sandbox reflects provider status after configuration", async () => {
  const state: ProviderState = { data: { status: "pending", statusReason: null }, createCalls: [] };
  const server = await withSandboxServer(state);
  try {
    // Seed the local key via a successful PUT.
    const put = await fetch(`${baseUrl(server.port)}/api/settings/sandbox`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "k1" }),
    });
    assert.equal(put.status, 200);

    const getStatus = async (): Promise<Record<string, unknown>> => {
      const res = await fetch(`${baseUrl(server.port)}/api/settings/sandbox`);
      assert.equal(res.status, 200);
      return (await res.json()) as Record<string, unknown>;
    };

    state.data = { status: "pending", statusReason: null };
    assert.deepEqual(await getStatus(), { configured: true, status: "pending" });

    state.data = { status: "ready", statusReason: null };
    assert.deepEqual(await getStatus(), { configured: true, status: "ready" });

    state.data = { status: "failed", statusReason: "no-quota" };
    assert.deepEqual(await getStatus(), {
      configured: true,
      status: "error",
      errorReason: "no-quota",
    });

    // Provider lost its configuration → reads unconfigured again.
    state.error = { statusCode: 404, message: "60000: sandbox provider not configured" };
    assert.deepEqual(await getStatus(), { configured: false, status: "unconfigured" });
  } finally {
    await server.close();
  }
});
