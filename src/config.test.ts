import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, parsePort } from "./config";

const emptyEnv = {} as NodeJS.ProcessEnv;

function env(entries: Record<string, string>): NodeJS.ProcessEnv {
  return entries as NodeJS.ProcessEnv;
}

test("port/host/logLevel defaults", () => {
  const cfg = loadConfig(emptyEnv);
  assert.equal(cfg.port, 3000);
  assert.equal(cfg.host, "0.0.0.0");
  assert.equal(cfg.logLevel, "info");
});

test("PORT env overrides default", () => {
  assert.equal(loadConfig(env({ PORT: "4000" })).port, 4000);
});

test("CLI port flag beats env", () => {
  assert.equal(loadConfig(env({ PORT: "4000" }), { port: 5000 }).port, 5000);
});

test("invalid port falls back to default", () => {
  assert.equal(loadConfig(emptyEnv, { port: 70000 }).port, 3000);
  assert.equal(loadConfig(env({ PORT: "abc" })).port, 3000);
});

test("trueforge env config surfaces", () => {
  const cfg = loadConfig(env({ TRUEFORGE_BASE_URL: "http://tf.example.invalid", TRUEFORGE_TOKEN: "tok123" }));
  assert.equal(cfg.trueforgeBaseUrl, "http://tf.example.invalid");
  assert.equal(cfg.trueforgeToken, "tok123");
});

test("parsePort handles valid and invalid values", () => {
  assert.equal(parsePort("3000"), 3000);
  assert.equal(parsePort(8080), 8080);
  assert.equal(parsePort("abc"), undefined);
  assert.equal(parsePort("70000"), undefined);
  assert.equal(parsePort(""), undefined);
  assert.equal(parsePort(undefined), undefined);
});
