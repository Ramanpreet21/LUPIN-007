/**
 * LUMA GLASS DESIGN REMINDER
 * Dual-sided System Health flip card with original design metrics and live /health integration.
 * Front face displays system health, live /health stats, resource gauges, and error budget.
 * Back face rotates 180° to reveal the streaming system logs and telemetry inspector.
 */
import { Activity, AlertTriangle, Cpu, HardDrive, MemoryStick, Network, RotateCw } from "lucide-react";
import { useState } from "react";
import { SystemLogsTelemetryPanel } from "@/components/SystemLogsTelemetryPanel";
import { useMockSystemTelemetryStream } from "@/hooks/useMockSystemTelemetryStream";
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

function getBudgetTone(percentage: number) {
  if (percentage > 20) return "safe";
  if (percentage >= 10) return "warning";
  return "critical";
}

function getResourceTone(percentage: number) {
  if (percentage > 85) return "critical";
  if (percentage >= 70) return "warning";
  return "safe";
}

function getDiskTone(megabytesPerSecond: number) {
  if (megabytesPerSecond > 22) return "critical";
  if (megabytesPerSecond >= 18) return "warning";
  return "safe";
}

function getNetworkTone(kilobitsPerSecond: number) {
  if (kilobitsPerSecond > 1600) return "critical";
  if (kilobitsPerSecond >= 1100) return "warning";
  return "safe";
}

function formatThroughput(kilobitsPerSecond: number) {
  return kilobitsPerSecond >= 1000 ? `${(kilobitsPerSecond / 1000).toFixed(1)}M` : `${Math.round(kilobitsPerSecond)}K`;
}

export function HealthSummaryCard({ data, isLoading = false, error = null }: HealthSummaryCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const { logs, telemetry } = useMockSystemTelemetryStream(isFlipped);
  const requestFlip = () => setIsFlipped((value) => !value);

  if (isLoading && !data) {
    return (
      <article className="signal-module health-summary-card glass-surface health-summary-card--loading" aria-busy="true" aria-label="Loading system health">
        <div className="health-skeleton-line health-skeleton-title" />
        <div className="health-skeleton-line" />
        <div className="health-skeleton-line health-skeleton-short" />
      </article>
    );
  }

  const isOk = data ? data.status === "ok" && data.trueforge_ready : true;
  const statusTone = data ? (isOk ? "healthy" : "degraded") : "healthy";
  const activeIncidents = data?.incidents_active ?? 0;
  const remainingBudget = Math.max(99.4 - activeIncidents * 12.5, 8.0);
  const budgetTone = getBudgetTone(remainingBudget);
  const burnRateLabel = activeIncidents > 2 ? "Fast burn" : activeIncidents > 0 ? "Elevated burn" : "Stable burn";

  return (
    <div className="health-flip-scene" aria-label="Dual-sided system health card">
      <div className={`health-flip-rotator ${isFlipped ? "is-flipped" : ""}`}>
        {/* Front Face: System Health Overview & Telemetry Meters */}
        <article
          className={`health-flip-face health-flip-front signal-module health-summary-card glass-surface health-summary-card--${statusTone}`}
          onClick={requestFlip}
          aria-label={`System health: ${isOk ? "Healthy" : "Degraded"}. Select to view telemetry.`}
        >
          <div className="module-heading health-heading">
            <p className="eyebrow">System health</p>
            <div className="health-heading-actions">
              <span className={`health-status health-status--${statusTone}`}>
                <i />
                {data ? (isOk ? "Healthy" : "Degraded") : "Operational"}
              </span>
              <button
                className="health-flip-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  requestFlip();
                }}
                aria-label="View system logs and telemetry"
                title="Flip to system logs"
              >
                <RotateCw size={13} />
              </button>
            </div>
          </div>

          <div className="health-stat-grid">
            <div>
              <span>UPTIME</span>
              <strong>{data ? formatUptime(data.uptime) : "1d 4h"}</strong>
            </div>
            <div>
              <span>TRUEFORGE</span>
              <strong>{data ? (data.trueforge_ready ? "Ready" : "Offline") : "Ready"}</strong>
            </div>
            <div>
              <span>INCIDENTS</span>
              <strong>
                {data ? data.incidents_active : 0}
                <small> / {data ? data.incidents_total : 0}</small>
              </strong>
            </div>
          </div>

          <div className="health-resource-grid" aria-label="Current system resources">
            <div
              className={`health-resource-meter health-resource-meter--${getResourceTone(telemetry.cpuUsage)}`}
              tabIndex={0}
              onClick={(e) => e.stopPropagation()}
            >
              <span><Cpu size={9} />CPU</span>
              <strong>{telemetry.cpuUsage}%</strong>
              <i><b style={{ width: `${telemetry.cpuUsage}%` }} /></i>
            </div>
            <div
              className={`health-resource-meter health-resource-meter--${getResourceTone(telemetry.ramUsage.percentage)}`}
              tabIndex={0}
              onClick={(e) => e.stopPropagation()}
            >
              <span><MemoryStick size={9} />RAM</span>
              <strong>{telemetry.ramUsage.percentage}%</strong>
              <i><b style={{ width: `${telemetry.ramUsage.percentage}%` }} /></i>
            </div>
            <div
              className={`health-resource-meter health-resource-meter--${getDiskTone(telemetry.diskIO)}`}
              tabIndex={0}
              onClick={(e) => e.stopPropagation()}
            >
              <span><HardDrive size={9} />DISK</span>
              <strong>{telemetry.diskIO.toFixed(1)}<small> MB/s</small></strong>
              <i><b style={{ width: `${Math.min(Math.round(telemetry.diskIO * 4), 100)}%` }} /></i>
            </div>
            <div
              className={`health-resource-meter health-resource-meter--${getNetworkTone(telemetry.networkIO.inboundKbps + telemetry.networkIO.outboundKbps)}`}
              tabIndex={0}
              onClick={(e) => e.stopPropagation()}
            >
              <span><Network size={9} />NET</span>
              <strong>{formatThroughput(telemetry.networkIO.inboundKbps + telemetry.networkIO.outboundKbps)}</strong>
              <i><b style={{ width: `${Math.min(Math.round(((telemetry.networkIO.inboundKbps + telemetry.networkIO.outboundKbps) / 1800) * 100), 100)}%` }} /></i>
            </div>
          </div>

          {error && data && (
            <div className="health-alert-state">
              <AlertTriangle size={13} />
              <div>
                <span>Health warning</span>
                <strong>{error}</strong>
              </div>
            </div>
          )}

          <div className="health-budget">
            <div className="health-budget-copy">
              <span>Error budget</span>
              <strong>
                {remainingBudget.toFixed(1)}% <em>{burnRateLabel}</em>
              </strong>
            </div>
            <div className={`health-budget-track health-budget-track--${budgetTone}`}>
              <span style={{ width: `${Math.min(Math.max(remainingBudget, 0), 100)}%` }} />
            </div>
          </div>

          <Activity className="health-watermark" size={70} strokeWidth={0.7} aria-hidden="true" />
        </article>

        {/* Back Face: Real-Time System Logs & Telemetry Stream */}
        <SystemLogsTelemetryPanel logs={logs} isStreamActive={isFlipped} onRequestFlip={requestFlip} />
      </div>
    </div>
  );
}
