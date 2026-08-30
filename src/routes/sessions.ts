import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";

export interface SessionsRouterOptions {
  logger?: Logger;
}

export function createSessionsRouter(opts?: SessionsRouterOptions): Router {
  const router = Router();

  router.get("/api/sessions", (_req: Request, res: Response) => {
    const db = getDb();
    const limit = Number(_req.query.limit) || 50;
    const rows = db.prepare("SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?").all(limit);
    res.json({ data: rows });
  });

  router.get("/api/sessions/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const db = getDb();
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    if (!session) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    res.json(session);
  });

  return router;
}
