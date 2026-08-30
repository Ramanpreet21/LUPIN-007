import http from "node:http";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Checks if a UNIX domain socket responds to HTTP ping.
 */
export function probeUnixSocket(socketPath: string, timeoutMs = 1500): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  return new Promise((resolve) => {
    if (!fs.existsSync(socketPath)) {
      return resolve({ ok: false, latencyMs: 0, error: `Socket not found at ${socketPath}` });
    }

    const t0 = Date.now();
    const req = http.request(
      {
        socketPath,
        path: "/_ping",
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        const latencyMs = Date.now() - t0;
        if (res.statusCode === 200 || res.statusCode === 204) {
          resolve({ ok: true, latencyMs });
        } else {
          resolve({ ok: false, latencyMs, error: `Socket returned HTTP ${res.statusCode}` });
        }
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, latencyMs: Date.now() - t0, error: `Connection timed out after ${timeoutMs}ms` });
    });

    req.on("error", (err) => {
      resolve({ ok: false, latencyMs: Date.now() - t0, error: err.message });
    });

    req.end();
  });
}

/**
 * Probes whether a CLI binary exists and executes cleanly.
 */
export async function probeCliBinary(binaryName: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const { stdout } = await execFileAsync(binaryName, ["--version"], { timeout: 3000 });
    return { ok: true, version: stdout.trim().split("\n")[0] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Probes HTTP URL endpoint (e.g. for Daytona dedicated server).
 */
export async function probeHttpUrl(url: string, token?: string, timeoutMs = 3000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, latencyMs: 0, error: `Invalid server URL format: ${url}` };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, latencyMs: 0, error: `Unsupported protocol ${parsed.protocol} (must be http or https)` };
    }

    const targetUrl = url.endsWith("/health") || url.endsWith("/api/v1/health") ? url : `${url.replace(/\/+$/, "")}/health`;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(targetUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "error", // Prevent automatic redirect following
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    if (res.ok || res.status === 401 || res.status === 403) {
      // 401/403 means server exists but key may be required or validated
      return { ok: res.ok, latencyMs, error: res.ok ? undefined : `Server returned HTTP ${res.status}` };
    }
    return { ok: false, latencyMs, error: `Server returned HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
  }
}
