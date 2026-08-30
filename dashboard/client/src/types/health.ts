/**
 * LUMA GLASS DESIGN REMINDER
 * This contract deliberately separates streaming state from the existing
 * low-contrast glass presentation layer. Live data can replace fixtures
 * without changing the card's rendered structure.
 */
export type HealthStatus = "HEALTHY" | "DEGRADED" | "CRITICAL";
export type BurnRateStatus = "STABLE" | "ELEVATED" | "FAST_BURN";

export interface CriticalAlert {
  id: string;
  serviceName: string;
  timestamp: string;
  message: string;
}

export interface HealthSummary {
  aggregateStatus: HealthStatus;
  activeCriticalAlerts: {
    count: number;
    items: CriticalAlert[];
  };
  uptime: number;
  trueforge_ready: boolean;
  incidents_active: number;
  incidents_total: number;
}

/** Live control-plane health relayed by GET /health (PR #4 4d). */
export interface ControlPlaneHealth {
  status: string;
  uptime: number;
  trueforge_ready: boolean;
  incidents_active: number;
  incidents_total: number;
}

export interface HealthSummaryCardProps {
  data: ControlPlaneHealth | null;
  isLoading?: boolean;
  error?: string | null;
}
