import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";
import type { TrueForgeHandle } from "../trueforge";
import { CONVERSATIONAL_ASSISTANT_PROMPT } from "../trueforge-config";

export interface SessionsRouterOptions {
  getTf?: () => TrueForgeHandle;
  logger?: Logger;
  broadcast?: (message: unknown) => void;
  model?: string;
}

export function createSessionsRouter(opts?: SessionsRouterOptions): Router {
  const router = Router();
  const getTf = opts?.getTf;
  const logger = opts?.logger;
  const broadcast = opts?.broadcast;
  const defaultModel = opts?.model ?? "anthropic/claude-sonnet-5";

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

  router.post("/api/sessions", async (req: Request, res: Response) => {
    const db = getDb();
    const body = (req.body ?? {}) as { summary?: string; model?: string };
    const tf = getTf?.();
    const client = tf?.client;

    let activeModel = body.model;
    if (!activeModel) {
      try {
        const modelSetting = db.prepare("SELECT value FROM settings WHERE key = 'model'").get() as { value?: string } | undefined;
        activeModel = modelSetting?.value || defaultModel;
      } catch {
        activeModel = defaultModel;
      }
    }

    let sessionId = `session-${Date.now()}`;
    const threadId: string | null = null;

    if (client && tf?.status.state === "ready") {
      try {
        const { data } = await client.sessions.create({
          agent: {
            spec: {
              model: { name: activeModel },
              instructions: CONVERSATIONAL_ASSISTANT_PROMPT,
              config: { sandbox: { enabled: false } },
            },
          },
        });
        sessionId = data.id;
      } catch (err) {
        logger?.warn({ event: "tf_session_create_fallback", err }, "TrueForge session creation fallback to local ID");
      }
    }

    const summary = body.summary || `Interactive Session ${sessionId.slice(0, 8)}`;
    const createdAt = new Date().toISOString();

    try {
      db.prepare(
        `INSERT INTO sessions (id, thread_id, incident_id, summary, created_at)
         VALUES (@id, @thread_id, @incident_id, @summary, @created_at)`
      ).run({
        id: sessionId,
        thread_id: threadId,
        incident_id: null,
        summary,
        created_at: createdAt,
      });

      broadcast?.({
        type: "session_created",
        payload: { session_id: sessionId, summary, created_at: createdAt },
      });
    } catch { /* DB insert error */ }

    res.status(201).json({
      id: sessionId,
      summary,
      created_at: createdAt,
    });
  });

  router.get("/api/sessions/:id/messages", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const db = getDb();
    const rows = db.prepare("SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC").all(id);
    res.json({ data: rows });
  });

  router.delete("/api/sessions/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const db = getDb();
    const tf = getTf?.();
    const client = tf?.client;

    if (client && tf?.status.state === "ready") {
      try {
        await client.sessions.cancel(id);
      } catch { /* best effort */ }
    }

    db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    res.json({ status: "ok", deleted: id });
  });

  return router;
}
