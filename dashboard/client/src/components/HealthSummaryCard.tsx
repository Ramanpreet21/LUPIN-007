/**
 * LUMA GLASS DESIGN REMINDER
 * This pure presentation component retains the dashboard's compact dark-glass
 * module anatomy. State ownership intentionally remains outside this file so
 * a future metrics stream can replace fixtures without markup changes.
 */
import { Activity, AlertTriangle, Cpu, HardDrive, MemoryStick, Network, RotateCw } from "lucide-react";
import { useState } from "react";
import { SystemLogsTelemetryPanel } from "@/components/SystemLogsTelemetryPanel";
import { useMockSystemTelemetryStream } from "@/hooks/useMockSystemTelemetryStream";
import type { BurnRateStatus, HealthStatus, HealthSummaryCardProps } from "@/types/health";

const statusLabels: Record<HealthStatus, string> = {
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  CRITICAL: "Critical",
};

const burnRateLabels: Record<BurnRateStatus, string> = {
  STABLE: "Stable burn",
  ELEVATED: "Elevated burn",
  FAST_BURN: "Fast burn",
};

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

export function HealthSummaryCard({ data, isLoading = false }: HealthSummaryCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const statusTone = data.aggregateStatus.toLowerCase();
  const budgetTone = getBudgetTone(data.errorBudget.remainingPercentage);
  const firstAlert = data.activeCriticalAlerts.items[0];
  const { logs, telemetry } = useMockSystemTelemetryStream(isFlipped);
  const requestFlip = () => setIsFlipped((value) => !value);

  if (isLoading) {
    return (
      <article className="signal-module health-summary-card glass-surface health-summary-card--loading" aria-busy="true" aria-label="Loading system health">
        <div className="health-skeleton-line health-skeleton-title" />
        <div className="health-skeleton-line" />
        <div className="health-skeleton-line health-skeleton-short" />
      </article>
    );
  }

  return (
    <div className="health-flip-scene" aria-label="Dual-sided system health card">
      <div className={`health-flip-rotator ${isFlipped ? "is-flipped" : ""}`}>
    <article className={`health-flip-face health-flip-front signal-module health-summary-card glass-surface health-summary-card--${statusTone}`} onClick={requestFlip} aria-label={`System health: ${statusLabels[data.aggregateStatus]}. Select to view telemetry.`}>
      <div className="module-heading health-heading">
        <p className="eyebrow">System health</p>
        <div className="health-heading-actions"><span className={`health-status health-status--${statusTone}`}><i />{statusLabels[data.aggregateStatus]}</span><button className="health-flip-button" type="button" onClick={(event) => { event.stopPropagation(); requestFlip(); }} aria-label="View system logs and telemetry"><RotateCw size={13} /></button></div>
      </div>

      <div className="health-stat-grid">
        <div><span>TRAFFIC</span><strong>{data.trafficRate.rps.toLocaleString()}<small> rps</small></strong></div>
        <div><span>ERROR RATE</span><strong>{data.errorRate.percentage.toFixed(2)}<small>%</small></strong></div>
        <div><span>FAILED / MIN</span><strong>{data.errorRate.failedRequestsPerMin.toLocaleString()}</strong></div>
      </div>

      <div className="health-resource-grid" aria-label="Current system resources">
        <div className={`health-resource-meter health-resource-meter--${getResourceTone(telemetry.cpuUsage)}`} tabIndex={0} onClick={(event) => event.stopPropagation()} aria-describedby="cpu-threshold"><span><Cpu size={9} />CPU</span><strong>{telemetry.cpuUsage}%</strong><i><b style={{ width: `${telemetry.cpuUsage}%` }} /></i><span id="cpu-threshold" className="resource-threshold-tooltip" role="tooltip">Warning at 70%; critical at 85%.</span></div>
        <div className={`health-resource-meter health-resource-meter--${getResourceTone(telemetry.ramUsage.percentage)}`} tabIndex={0} onClick={(event) => event.stopPropagation()} aria-describedby="ram-threshold"><span><MemoryStick size={9} />RAM</span><strong>{telemetry.ramUsage.percentage}%</strong><i><b style={{ width: `${telemetry.ramUsage.percentage}%` }} /></i><span id="ram-threshold" className="resource-threshold-tooltip" role="tooltip">Warning at 70%; critical at 85%.</span></div>
        <div className={`health-resource-meter health-resource-meter--${getDiskTone(telemetry.diskIO)}`} tabIndex={0} onClick={(event) => event.stopPropagation()} aria-describedby="disk-threshold"><span><HardDrive size={9} />DISK</span><strong>{telemetry.diskIO.toFixed(1)}<small> MB/s</small></strong><i><b style={{ width: `${Math.min(Math.round(telemetry.diskIO * 4), 100)}%` }} /></i><span id="disk-threshold" className="resource-threshold-tooltip" role="tooltip">Warning at 18 MB/s; critical above 22 MB/s.</span></div>
        <div className={`health-resource-meter health-resource-meter--${getNetworkTone(telemetry.networkIO.inboundKbps + telemetry.networkIO.outboundKbps)}`} tabIndex={0} onClick={(event) => event.stopPropagation()} aria-label={`Network throughput: ${telemetry.networkIO.inboundKbps} kilobits per second inbound and ${telemetry.networkIO.outboundKbps} kilobits per second outbound.`}><span><Network size={9} />NET</span><strong>{formatThroughput(telemetry.networkIO.inboundKbps + telemetry.networkIO.outboundKbps)}</strong><i><b style={{ width: `${Math.min(Math.round(((telemetry.networkIO.inboundKbps + telemetry.networkIO.outboundKbps) / 1800) * 100), 100)}%` }} /></i><span className="resource-network-detail">↓{formatThroughput(telemetry.networkIO.inboundKbps)} ↑{formatThroughput(telemetry.networkIO.outboundKbps)}</span></div>
      </div>

      {data.activeCriticalAlerts.count > 0 && (
        <div className="health-alert-state"><AlertTriangle size={13} /><div><span>{data.activeCriticalAlerts.count} critical alert{data.activeCriticalAlerts.count === 1 ? "" : "s"}</span><strong>{firstAlert.serviceName}: {firstAlert.message}</strong></div></div>
      )}

      <div className="health-budget">
        <div className="health-budget-copy"><span>Error budget</span><strong>{data.errorBudget.remainingPercentage.toFixed(1)}% <em>{burnRateLabels[data.errorBudget.burnRate]}</em></strong></div>
        <div className={`health-budget-track health-budget-track--${budgetTone}`}><span style={{ width: `${Math.min(Math.max(data.errorBudget.remainingPercentage, 0), 100)}%` }} /></div>
      </div>
      <Activity className="health-watermark" size={70} strokeWidth={.7} aria-hidden="true" />
    </article>
    <SystemLogsTelemetryPanel logs={logs} isStreamActive={isFlipped} onRequestFlip={requestFlip} />
      </div>
    </div>
  );
}
