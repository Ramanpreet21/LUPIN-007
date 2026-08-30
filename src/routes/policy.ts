/**
 * Express router for policy rule management and AST simulation endpoints (PR #5 §5e).
 */
import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";
import {
  createPolicyRule,
  deletePolicyRule,
  getPolicyRule,
  listPolicyRules,
  simulatePolicy,
  updatePolicyRule,
  validateSafeRegex,
  type PolicyCategory,
  type PolicySeverity,
} from "../policy";

export interface PolicyRouterOptions {
  logger?: Logger;
}

const VALID_CATEGORIES = new Set<PolicyCategory>([
  "DESTRUCTIVE_FS",
  "PRIVILEGE_ESCALATION",
  "NETWORK_EXFIL",
  "PROCESS_TERMINATION",
]);

const VALID_SEVERITIES = new Set<PolicySeverity>([
  "CRITICAL_BLOCK",
  "REQUIRE_APPROVAL",
  "WARN",
]);

export function createPolicyRouter(opts?: PolicyRouterOptions): Router {
  const router = Router();
  const logger = opts?.logger;

  router.get("/api/policy/rules", (_req: Request, res: Response) => {
    res.json({ data: listPolicyRules() });
  });

  router.get("/api/policy/rules/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const rule = getPolicyRule(id);
    if (!rule) {
      res.status(404).json({ error: "rule_not_found" });
      return;
    }
    res.json(rule);
  });

  router.post("/api/policy/rules", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const regex = typeof body.regex === "string" ? body.regex.trim() : "";
    const category = body.category as PolicyCategory;
    const severity = body.severity as PolicySeverity;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;

    if (!name || !regex || !category || !severity) {
      res.status(400).json({
        error: "invalid_payload",
        details: ["name, regex, category, and severity are required fields"],
      });
      return;
    }

    if (!VALID_CATEGORIES.has(category)) {
      res.status(400).json({
        error: "invalid_category",
        details: [`category must be one of: ${Array.from(VALID_CATEGORIES).join(", ")}`],
      });
      return;
    }

    if (!VALID_SEVERITIES.has(severity)) {
      res.status(400).json({
        error: "invalid_severity",
        details: [`severity must be one of: ${Array.from(VALID_SEVERITIES).join(", ")}`],
      });
      return;
    }

    try {
      validateSafeRegex(regex);
    } catch (err) {
      res.status(400).json({
        error: "invalid_regex",
        details: [err instanceof Error ? err.message : String(err)],
      });
      return;
    }

    const rule = createPolicyRule({
      name,
      regex,
      category,
      severity,
      enabled,
      reasonDescription: typeof body.reasonDescription === "string" ? body.reasonDescription : undefined,
      matchExpression: typeof body.matchExpression === "string" ? body.matchExpression : undefined,
      binaryName: typeof body.binaryName === "string" ? body.binaryName : undefined,
      forbiddenFlags: Array.isArray(body.forbiddenFlags) ? body.forbiddenFlags.map(String) : undefined,
    });

    logger?.info({ event: "policy_rule_created", ruleId: rule.id, name: rule.name }, "policy rule created");
    res.status(201).json(rule);
  });

  router.patch("/api/policy/rules/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.reasonDescription === "string") patch.reasonDescription = body.reasonDescription;
    if (typeof body.matchExpression === "string") patch.matchExpression = body.matchExpression;
    if (typeof body.binaryName === "string") patch.binaryName = body.binaryName;
    if (Array.isArray(body.forbiddenFlags)) patch.forbiddenFlags = body.forbiddenFlags.map(String);

    if (body.category !== undefined) {
      if (!VALID_CATEGORIES.has(body.category as PolicyCategory)) {
        res.status(400).json({
          error: "invalid_category",
          details: [`category must be one of: ${Array.from(VALID_CATEGORIES).join(", ")}`],
        });
        return;
      }
      patch.category = body.category;
    }

    if (body.severity !== undefined) {
      if (!VALID_SEVERITIES.has(body.severity as PolicySeverity)) {
        res.status(400).json({
          error: "invalid_severity",
          details: [`severity must be one of: ${Array.from(VALID_SEVERITIES).join(", ")}`],
        });
        return;
      }
      patch.severity = body.severity;
    }

    if (body.regex !== undefined) {
      if (typeof body.regex !== "string" || !body.regex.trim()) {
        res.status(400).json({
          error: "invalid_regex",
          details: ["regex must be a non-empty string"],
        });
        return;
      }
      try {
        validateSafeRegex(body.regex);
        patch.regex = body.regex.trim();
      } catch (err) {
        res.status(400).json({
          error: "invalid_regex",
          details: [err instanceof Error ? err.message : String(err)],
        });
        return;
      }
    }

    const updated = updatePolicyRule(id, patch as any);
    if (!updated) {
      res.status(404).json({ error: "rule_not_found" });
      return;
    }

    res.json(updated);
  });

  router.delete("/api/policy/rules/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const ok = deletePolicyRule(id);
    if (!ok) {
      res.status(404).json({ error: "rule_not_found" });
      return;
    }
    res.json({ status: "ok" });
  });

  router.post("/api/policy/simulate", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const command = typeof body.command === "string" ? body.command : "";
    if (!command.trim()) {
      res.status(400).json({ error: "invalid_payload", details: ["command must be a non-empty string"] });
      return;
    }
    if (command.length > 4096) {
      res.status(400).json({ error: "invalid_payload", details: ["command exceeds maximum length of 4096 characters"] });
      return;
    }

    const result = simulatePolicy(command);
    res.json(result);
  });

  router.get("/api/policy/profiles", (_req: Request, res: Response) => {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM policy_profiles ORDER BY name").all() as Array<{ name: string; is_active: number; rule_ids: string; created_at: string }>;
    res.json({
      data: rows.map((r) => ({ name: r.name, is_active: Boolean(r.is_active), rule_ids: JSON.parse(r.rule_ids) })),
    });
  });

  router.put("/api/policy/profiles/:name", (req: Request, res: Response) => {
    const name = String(req.params.name);
    const db = getDb();
    const profile = db.prepare("SELECT * FROM policy_profiles WHERE name = ?").get(name);
    if (!profile) {
      res.status(404).json({ error: "profile_not_found" });
      return;
    }
    db.prepare("UPDATE policy_profiles SET is_active = 0").run();
    db.prepare("UPDATE policy_profiles SET is_active = 1 WHERE name = ?").run(name);
    res.json({ status: "ok", active: name });
  });

  router.get("/api/policy/stats", (_req: Request, res: Response) => {
    const rules = listPolicyRules();
    const active = rules.filter((r) => r.enabled);
    res.json({
      activeRules: active.length,
      blacklistedBinaries: active.filter((r) => r.severity === "CRITICAL_BLOCK").length,
      highRiskPatterns: active.filter((r) => r.category === "DESTRUCTIVE_FS" || r.category === "NETWORK_EXFIL").length,
      interceptedCount: 0, // live count will be incremented per gate trip
    });
  });

  router.put("/api/policy/mode", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = typeof body.mode === "string" ? body.mode : "";
    if (!["AUTONOMOUS", "STRICT_GATED", "DRY_RUN"].includes(mode)) {
      res.status(400).json({ error: "invalid_mode", details: ["mode must be AUTONOMOUS, STRICT_GATED, or DRY_RUN"] });
      return;
    }
    const db = getDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('enforcement_mode', @mode) ON CONFLICT(key) DO UPDATE SET value = @mode").run({ mode });
    res.json({ status: "ok", mode });
  });

  router.post("/api/policy/analyze", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const command = typeof body.command === "string" ? body.command : "";
    if (!command.trim()) {
      res.status(400).json({ error: "invalid_payload", details: ["command must be a non-empty string"] });
      return;
    }
    if (command.length > 4096) {
      res.status(400).json({ error: "invalid_payload", details: ["command exceeds maximum length of 4096 characters"] });
      return;
    }
    const result = simulatePolicy(command);
    res.json(result);
  });

  return router;
}
