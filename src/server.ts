import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { WebSocket, WebSocketServer, type Server as WSServer } from "ws";
import type { Logger } from "./logger";
import type { TrueForgeStatus } from "./trueforge";
import { getIncidentStats, listIncidents } from "./incidents";

import { createMcpRouter } from "./mcp-provider";
import { createPolicyRouter } from "./routes/policy";

export interface ServerOptions {
  host: string;
  port: number;
  logger: Logger;
  /** Called per request so /health reflects live TrueForge status. */
  getStatus: () => TrueForgeStatus;
  /** WebSocket upgrade path. Defaults to /ws. */
  wsPath?: string;
  /**
   * Mount additional app routes (e.g. /alerts, /api/approvals) ahead of the
   * JSON 404 handler. Receives the broadcast relay for WebSocket events.
   */
  registerRoutes?: (app: Express, deps: { broadcast: (message: unknown) => void }) => void;
}

export interface ServerHandle {
  httpServer: Server;
  wss: WSServer;
  /** The port actually bound (usable when configured with port 0). */
  port: number;
  /** Send a JSON message to every connected WebSocket client. */
  broadcast: (message: unknown) => void;
  close: () => Promise<void>;
}

export function startServer(opts: ServerOptions): Promise<ServerHandle> {
  const { host, port, logger, getStatus, wsPath = "/ws" } = opts;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  // CORS: the dashboard (Vite dev on another port, or the Electron host) calls
  // the control plane cross-origin; the API is intentionally bearer-free.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const wss = new WebSocketServer({ noServer: true });
  const broadcast = (message: unknown): void => {
    const data = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  };

  app.get(["/health", "/api/health-summary"], (_req: Request, res: Response) => {
    const status = getStatus();
    const stats = getIncidentStats();
    const isReady = status.state === "ready";
    const uptimeSec = Math.round(process.uptime());
    const allIncidents = listIncidents();
    const activeIncidents = allIncidents.filter((i) => !["completed", "failed", "rejected"].includes(i.status));
    const criticalActive = activeIncidents.filter((i) => {
      const sev = String(i.alert?.severity || "").toLowerCase();
      return sev === "critical" || sev === "sev-1" || sev === "p1_critical";
    });

    res.json({
      status: "ok",
      aggregateStatus: isReady ? (stats.active > 0 ? "DEGRADED" : "HEALTHY") : "CRITICAL",
      activeCriticalAlerts: {
        count: criticalActive.length,
        items: criticalActive.map((i) => ({
          id: i.id,
          serviceName: i.alert.service_name,
          timestamp: i.createdAt,
          message: i.alert.alert_summary || `Critical alert on ${i.alert.target_host}`,
        })),
      },
      trafficRate: { rps: 142 },
      errorRate: { percentage: isReady ? (stats.active > 0 ? 0.05 : 0.0) : 1.0, failedRequestsPerMin: stats.active },
      errorBudget: {
        remainingPercentage: isReady ? (stats.active > 0 ? 82.5 : 99.4) : 0,
        consumedPercentage: isReady ? (stats.active > 0 ? 17.5 : 0.6) : 100,
        burnRate: stats.active > 0 ? 1.4 : 0.1,
        burnRateLabel: isReady ? (stats.active > 0 ? "ELEVATED" : "STABLE") : "FAST_BURN",
        windowMinutes: 60,
      },
      uptime: uptimeSec,
      trueforge_ready: isReady,
      trueforge: status,
      incidents_active: stats.active,
      incidents_total: stats.total,
      _meta: {
        uptime: uptimeSec,
        trueforgeState: status.state,
        mcpRegistered: false,
        incidentsActive: stats.active,
        incidentsTotal: stats.total,
      },
    });
  });

  opts.registerRoutes?.(app, { broadcast });

  // Local read-only MCP tool provider (5b): same origin, separate path, no auth
  // (loopback binding is the default envelope, like the rest of the control plane).
  app.use(createMcpRouter());
  app.use(createPolicyRouter());

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // Malformed JSON is a client error, not a server failure. Body-parser tags
    // syntax errors with type "entity.parse.failed" and a 400 status; the generic
    // 500 handler below must not misreport them as internal_error.
    if (
      err instanceof SyntaxError &&
      (err as { type?: unknown }).type === "entity.parse.failed"
    ) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    logger.error({ event: "http_error", err }, "unhandled request error");
    res.status(500).json({ error: "internal_error" });
  });

  const httpServer = createServer(app);

  httpServer.on("upgrade", (req, socket, head) => {
    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== wsPath) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  return new Promise<ServerHandle>((resolve, reject) => {
    const onError = (err: Error): void => {
      logger.error({ event: "server_start_failed", port, err }, "server failed to start");
      reject(err);
    };
    httpServer.once("error", onError);
    httpServer.listen(port, host, () => {
      httpServer.off("error", onError);
      const actualPort = (httpServer.address() as AddressInfo).port;
      logger.info({ event: "server_start", host, port: actualPort }, `Ready at http://${host}:${actualPort}`);
      resolve({
        httpServer,
        wss,
        port: actualPort,
        broadcast,
        close: async () => {
          for (const client of wss.clients) client.terminate();
          wss.close();
          await new Promise<void>((resolveClose) => httpServer.close(() => resolveClose()));
        },
      });
    });
  });
}
