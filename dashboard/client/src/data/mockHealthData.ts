import type { HealthStatus, HealthSummary } from "@/types/health";

/**
 * LUMA GLASS DESIGN REMINDER
 * Fixtures provide stable dimensions for each system state until a stream
 * adapter supplies the same HealthSummary contract with live data.
 */
export const mockHealthData: Record<HealthStatus, HealthSummary> = {
  HEALTHY: {
    aggregateStatus: "HEALTHY",
    activeCriticalAlerts: { count: 0, items: [] },
    trafficRate: { rps: 126 },
    errorRate: { percentage: 0.04, failedRequestsPerMin: 1 },
    errorBudget: { remainingPercentage: 99.2, burnRate: "STABLE" },
  },
  DEGRADED: {
    aggregateStatus: "DEGRADED",
    activeCriticalAlerts: {
      count: 1,
      items: [{ id: "edge-router-latency", serviceName: "Edge router", timestamp: "2026-08-25T10:14:00.000Z", message: "Latency above the operating target" }],
    },
    trafficRate: { rps: 204 },
    errorRate: { percentage: 2.36, failedRequestsPerMin: 28 },
    errorBudget: { remainingPercentage: 16.4, burnRate: "ELEVATED" },
  },
  CRITICAL: {
    aggregateStatus: "CRITICAL",
    activeCriticalAlerts: {
      count: 2,
      items: [{ id: "payments-timeout", serviceName: "Payments", timestamp: "2026-08-25T10:15:00.000Z", message: "Request timeouts are accelerating" }],
    },
    trafficRate: { rps: 79 },
    errorRate: { percentage: 13.8, failedRequestsPerMin: 164 },
    errorBudget: { remainingPercentage: 6.2, burnRate: "FAST_BURN" },
  },
};
