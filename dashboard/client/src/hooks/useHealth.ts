import { useEffect, useState } from "react";
import type { ControlPlaneHealth } from "@/types/health";

export interface UseHealthReturn {
  data: ControlPlaneHealth | null;
  isLoading: boolean;
  error: string | null;
}

/** Control-plane origin (mirrors the same env override in useControlPlane). */
const CONTROL_PLANE_ORIGIN =
  import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";

/**
 * Polls GET /health every `pollMs` (default 10s) and exposes the latest payload.
 * Keeps the last good snapshot after a failed poll instead of blanking the card.
 */
export function useHealth(pollMs = 10_000): UseHealthReturn {
  const [data, setData] = useState<ControlPlaneHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${CONTROL_PLANE_ORIGIN}/health`);
        if (!response.ok) throw new Error(`health check failed (HTTP ${response.status})`);
        const body = (await response.json()) as ControlPlaneHealth;
        if (cancelled) return;
        setData(body);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  return { data, isLoading, error };
}
