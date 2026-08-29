/**
 * LUMA GLASS DESIGN REMINDER
 * This pure presentation component retains the dashboard's compact dark-glass
 * module anatomy. It renders live control-plane health (GET /health) — the
 * fixture gauges (RPS, error rate, burn rate, resource meters) were cut because
 * no backend source backs them (PR #4 4d).
 */
import { Activity, AlertTriangle } from "lucide-react";
import type { HealthSummaryCardProps } from "@/types/health";

/** Compact uptime label (e.g. `2d 4h`, `45m`, `10s`). */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function HealthSummaryCard({ data, isLoading = false, error = null }: HealthSummaryCardProps) {
  if (isLoading && !data) {
    return (
      <article className="signal-module health-summary-card glass-surface health-summary-card--loading" aria-busy="true" aria-label="Loading system health">
        <div className="health-skeleton-line health-skeleton-title" />
        <div className="health-skeleton-line" />
        <div className="health-skeleton-line health-skeleton-short" />
      </article>
    );
  }

  if (!data) {
    return (
      <article className="signal-module health-summary-card glass-surface health-summary-card--degraded" aria-label="Control plane health: unavailable">
        <div className="module-heading health-heading">
          <p className="eyebrow">Control plane</p>
          <div className="health-heading-actions">
            <span className="health-status health-status--degraded"><i />Unavailable</span>
          </div>
        </div>
        <div className="health-alert-state">
          <AlertTriangle size={13} />
          <div>
            <span>Health check unavailable</span>
            <strong>{error ?? "No health snapshot yet."}</strong>
          </div>
        </div>
        <Activity className="health-watermark" size={70} strokeWidth={.7} aria-hidden="true" />
      </article>
    );
  }

  // /health always reports server liveness as status: "ok"; TrueForge readiness
  // is separate, so an offline provider must tone the card Degraded too (qodo #1).
  const isOk = data.status === "ok" && data.trueforge_ready;
  const statusTone = isOk ? "healthy" : "degraded";

  return (
    <article className={`signal-module health-summary-card glass-surface health-summary-card--${statusTone}`} aria-label={`Control plane health: ${isOk ? "operational" : "degraded"}`}>
      <div className="module-heading health-heading">
        <p className="eyebrow">Control plane</p>
        <div className="health-heading-actions"><span className={`health-status health-status--${statusTone}`}><i />{isOk ? "Operational" : "Degraded"}</span></div>
      </div>

      <div className="health-stat-grid">
        <div><span>UPTIME</span><strong>{formatUptime(data.uptime)}</strong></div>
        <div><span>TRUE FORGE</span><strong>{data.trueforge_ready ? "Ready" : "Offline"}</strong></div>
        <div><span>ACTIVE INCIDENTS</span><strong>{data.incidents_active}<small> / {data.incidents_total}</small></strong></div>
      </div>

      {error && (
        <div className="health-alert-state"><AlertTriangle size={13} /><div><span>Health check unavailable</span><strong>{error}</strong></div></div>
      )}

      <Activity className="health-watermark" size={70} strokeWidth={.7} aria-hidden="true" />
    </article>
  );
}
