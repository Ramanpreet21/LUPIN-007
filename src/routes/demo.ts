import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { startDemoStack, stopDemoStack, getDemoStatus, triggerDemoPrometheusAlert } from "../demo/compose-orchestrator";

export interface DemoRouterOptions {
  logger: Logger;
  broadcast?: (event: { type: string; payload: unknown }) => void;
  port?: number;
}

export function createDemoRouter(opts: DemoRouterOptions): Router {
  const router = Router();
  const logger = opts.logger;
  const broadcast = opts.broadcast;
  const port = opts.port || 3001;

  // 1. Start Demo Stack (Docker / Podman compose + auto config)
  router.post("/api/demo/start", async (_req: Request, res: Response) => {
    try {
      logger.info({ event: "demo_start_initiated" }, "initiating demo compose stack and fleet auto-registration");
      const result = await startDemoStack(broadcast);
      if (!result.ok) {
        logger.error({ event: "demo_start_failed", error: result.error }, "failed to start demo stack");
        res.status(503).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error({ event: "demo_start_error", err }, "unhandled error in demo start");
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 2. Get Demo Stack Status
  router.get("/api/demo/status", async (_req: Request, res: Response) => {
    try {
      const status = await getDemoStatus();
      res.json(status);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 3. Stop Demo Stack
  router.post("/api/demo/stop", async (_req: Request, res: Response) => {
    try {
      logger.info({ event: "demo_stop_initiated" }, "stopping demo compose stack");
      const result = await stopDemoStack();
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 4. Trigger Prometheus AlertManager Alert
  router.post("/api/demo/trigger-alert", async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { alertname?: string; severity?: string; summary?: string; description?: string };
      logger.info({ event: "demo_alert_triggered", body }, "triggering demo AlertManager incident");
      const result = await triggerDemoPrometheusAlert(port, body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
