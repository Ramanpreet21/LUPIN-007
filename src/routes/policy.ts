import { Router, type Request, type Response } from "express";
import { listPolicyRules, simulatePolicyRule } from "../policy";

/**
 * Policy routes (5e): read-only. GET the seeded rule matrix, POST a command to
 * simulate against it. There is deliberately no create / delete / toggle.
 */
export function createPolicyRouter(): Router {
  const router = Router();

  router.get("/api/policy/rules", (_req: Request, res: Response) => {
    res.json({ data: listPolicyRules() });
  });

  router.post("/api/policy/simulate", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const command = body.command;
    if (typeof command !== "string" || command.trim() === "") {
      res.status(400).json({ error: "invalid_payload", details: ["command must be a non-empty string"] });
      return;
    }
    res.json(simulatePolicyRule(command.trim()));
  });

  return router;
}
