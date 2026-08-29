import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getModelApiKey,
  getModelSettings,
  resetModelSettings,
  updateModelSettings,
} from "./model-settings";

test("storing an API key flips the configured flag but never leaks the key", () => {
  resetModelSettings();
  assert.deepEqual(getModelSettings(), { apiKeyConfigured: false });
  assert.equal(getModelApiKey(), undefined);

  updateModelSettings("sk-ant-test-1234");
  const status = getModelSettings();
  assert.deepEqual(status, { apiKeyConfigured: true });
  // Status deliberately has no apiKey field.
  assert.ok(!("apiKey" in status));
  // The key itself is retrievable only by the setup consumer.
  assert.equal(getModelApiKey(), "sk-ant-test-1234");
});

test("resetModelSettings clears the store for a clean first-run state", () => {
  updateModelSettings("sk-ant-test-9999");
  resetModelSettings();
  assert.deepEqual(getModelSettings(), { apiKeyConfigured: false });
  assert.equal(getModelApiKey(), undefined);
});
