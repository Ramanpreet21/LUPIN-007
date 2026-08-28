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
  trafficRate: {
    rps: number;
  };
  errorRate: {
    percentage: number;
    failedRequestsPerMin: number;
  };
  errorBudget: {
    remainingPercentage: number;
    burnRate: BurnRateStatus;
  };
}

export interface HealthSummaryCardProps {
  data: HealthSummary;
  isLoading?: boolean;
}
