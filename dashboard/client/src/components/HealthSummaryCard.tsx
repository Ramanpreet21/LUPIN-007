/**
 * LUMA GLASS DESIGN REMINDER
 * Dual-sided System Health flip card. Front face displays live control-plane
 * telemetry and resource meters (GET /health); back face rotates 180° to reveal
 * the streaming system logs and telemetry inspector.
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

  // /health reports server liveness as status: "ok"; TrueForge readiness is separate
  const isOk = data ? data.status === "ok" && data.trueforge_ready : false;
  const statusTone = data ? (isOk ? "healthy" : "degraded") : "degraded";

  return (
    <div className="health-flip-scene" aria-label="Dual-sided system health card">
      <div className={`health-flip-rotator ${isFlipped ? "is-flipped" : ""}`}>
        {/* Front Face: System Health Overview & Telemetry Meters */}
        <article
          className={`health-flip-face health-flip-front signal-module health-summary-card glass-surface health-summary-card--${statusTone}`}
          onClick={requestFlip}
          aria-label={`Control plane health: ${isOk ? "operational" : "degraded"}. Select to view system logs.`}
        >
          <div className="module-heading health-heading">
            <p className="eyebrow">Control plane</p>
            <div className="health-heading-actions">
              <span className={`health-status health-status--${statusTone}`}>
                <i />
                {data ? (isOk ? "Operational" : "Degraded") : "Unavailable"}
              </span>
              <button
                className="health-flip-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  requestFlip();
                }}
                aria-label="View system logs and telemetry stream"
                title="Flip to system logs"
              >
                <RotateCw size={13} />
              </button>
            </div>
          </div>

          {data ? (
            <div className="health-stat-grid">
              <div>
                <span>UPTIME</span>
                <strong>{formatUptime(data.uptime)}</strong>
              </div>
              <div>
                <span>TRUEFORGE</span>
                <strong>{data.trueforge_ready ? "Ready" : "Offline"}</strong>
              </div>
              <div>
                <span>INCIDENTS</span>
                <strong>
                  {data.incidents_active}
                  <small> / {data.incidents_total}</small>
                </strong>
              </div>
            </div>
          ) : (
            <div className="health-alert-state">
              <AlertTriangle size={13} />
              <div>
                <span>Health check unavailable</span>
                <strong>{error ?? "No health snapshot yet."}</strong>
              </div>
            </div>
          )}

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
                <span>Health check warning</span>
                <strong>{error}</strong>
              </div>
            </div>
          )}

          <Activity className="health-watermark" size={70} strokeWidth={0.7} aria-hidden="true" />
        </article>

        {/* Back Face: Real-Time System Logs & Telemetry Stream */}
        <SystemLogsTelemetryPanel logs={logs} isStreamActive={isFlipped} onRequestFlip={requestFlip} />
      </div>
    </div>
  );
}
