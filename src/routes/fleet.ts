import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { request as httpRequest } from "node:http";
import type { Logger } from "../logger";
import { getDb } from "../db";

export interface FleetRouterOptions {
  logger?: Logger;
  broadcast?: (message: unknown) => void;
}

export function createFleetRouter(opts?: FleetRouterOptions): Router {
  const router = Router();
  const logger = opts?.logger;
  const broadcast = opts?.broadcast;

  router.get("/api/fleet/hosts", (_req: Request, res: Response) => {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM fleet_hosts ORDER BY created_at DESC").all();
    res.json({ data: rows });
  });

  router.post("/api/fleet/hosts", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const hostname = typeof body.hostname === "string" ? body.hostname.trim() : "";
    if (!hostname) {
      res.status(400).json({ error: "invalid_payload", details: ["hostname is required"] });
      return;
    }
    const id = `host-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `INSERT INTO fleet_hosts (id, hostname, ip, port, ssh_user, ssh_key_path, podman_socket, created_at)
       VALUES (@id, @hostname, @ip, @port, @ssh_user, @ssh_key_path, @podman_socket, @created_at)`
    ).run({
      id,
      hostname,
      ip: typeof body.ip === "string" ? body.ip : null,
      port: typeof body.port === "number" ? body.port : 22,
      ssh_user: typeof body.ssh_user === "string" ? body.ssh_user : null,
      ssh_key_path: typeof body.ssh_key_path === "string" ? body.ssh_key_path : null,
      podman_socket: typeof body.podman_socket === "string" ? body.podman_socket : null,
      created_at: now,
    });
    const host = db.prepare("SELECT * FROM fleet_hosts WHERE id = ?").get(id);
    logger?.info({ event: "fleet_host_created", hostId: id }, "fleet host registered");
    res.status(201).json(host);
  });

  router.post("/api/fleet/probe", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const db = getDb();

    let hostname: string;
    let port: number;
    let podmanSocket: string | null = null;
    let hostId: string | null = null;

    if (typeof body.host_id === "string") {
      const host = db.prepare("SELECT * FROM fleet_hosts WHERE id = ?").get(body.host_id) as Record<string, unknown> | undefined;
      if (!host) {
        res.status(404).json({ error: "host_not_found" });
        return;
      }
      hostname = host.hostname as string;
      port = (host.port as number) || 22;
      podmanSocket = (host.podman_socket as string) || null;
      hostId = body.host_id;
    } else if (typeof body.hostname === "string") {
      hostname = body.hostname;
      port = typeof body.port === "number" ? body.port : 22;
      podmanSocket = typeof body.podman_socket === "string" ? body.podman_socket : null;
    } else {
      res.status(400).json({ error: "invalid_payload", details: ["host_id or hostname required"] });
      return;
    }

    // SSH TCP probe
    const sshResult = await new Promise<{ ok: boolean; latency_ms: number; error?: string }>((resolve) => {
      const start = Date.now();
      const socket = createConnection({ host: hostname, port, timeout: 5000 }, () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ ok: true, latency_ms: latency });
      });
      socket.on("error", (err) => {
        socket.destroy();
        resolve({ ok: false, latency_ms: Date.now() - start, error: err.message });
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ ok: false, latency_ms: Date.now() - start, error: "connection timeout (5s)" });
      });
    });

    // Podman socket probe (local unix socket only)
    let podmanResult: { ok: boolean; error?: string } = { ok: false, error: "no socket configured" };
    if (podmanSocket) {
      podmanResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const req = httpRequest({ socketPath: podmanSocket!, path: "/_ping", method: "GET", timeout: 3000 }, (response) => {
          let data = "";
          response.on("data", (chunk: Buffer) => { data += chunk.toString(); });
          response.on("end", () => resolve({ ok: response.statusCode === 200 }));
        });
        req.on("error", (err) => resolve({ ok: false, error: err.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout (3s)" }); });
        req.end();
      });
    }

    // Persist probe result
    if (hostId) {
      const now = new Date().toISOString();
      const probeStatus = sshResult.ok ? "online" : "offline";
      db.prepare(
        `UPDATE fleet_hosts SET last_probe_status = @status, last_probe_at = @at, probe_latency_ms = @latency, probe_error = @error WHERE id = @id`
      ).run({ status: probeStatus, at: now, latency: sshResult.latency_ms, error: sshResult.error ?? null, id: hostId });
      broadcast?.({ type: "fleet_updated", host_id: hostId, payload: { status: probeStatus, latency_ms: sshResult.latency_ms } });
    }

    res.json({ ssh: sshResult.ok, podman: podmanResult.ok, latency_ms: sshResult.latency_ms, error: sshResult.error ?? podmanResult.error });
  });

  router.delete("/api/fleet/hosts/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const db = getDb();
    const result = db.prepare("DELETE FROM fleet_hosts WHERE id = ?").run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: "host_not_found" });
      return;
    }
    res.json({ status: "ok" });
  });

  return router;
}
