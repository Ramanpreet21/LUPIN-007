import { test } from "node:test";
import assert from "node:assert/strict";
import { TrueForge } from "@truefoundry/trueforge-sdk";
import { createLogger } from "./logger";
import { initTrueForge } from "./trueforge";

const logger = createLogger("silent");
// Construction only - no network request is made by initTrueForge.
const BASE_URL = "http://tf.example.invalid";

test("requires a base URL", () => {
  const handle = initTrueForge({}, logger);
  assert.equal(handle.client, null);
  assert.deepEqual(handle.status, { state: "unconfigured", missing: ["TRUEFORGE_BASE_URL"] });
});

test("constructs a real client when base URL configured", () => {
  const handle = initTrueForge({ baseUrl: BASE_URL }, logger);
  assert.ok(handle.client instanceof TrueForge);
  assert.deepEqual(handle.status, { state: "ready", baseUrlConfigured: true, authConfigured: false });
});

test("records auth when a token is provided", () => {
  const handle = initTrueForge({ baseUrl: BASE_URL, token: "tok123" }, logger);
  assert.deepEqual(handle.status, { state: "ready", baseUrlConfigured: true, authConfigured: true });
});
