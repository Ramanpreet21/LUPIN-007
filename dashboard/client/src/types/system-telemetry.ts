/**
 * LUMA GLASS DESIGN REMINDER
 * The telemetry console consumes a transport-neutral contract so mock polling
 * can be replaced by SSE or WebSocket payloads without changing its markup.
 */
export type SystemLogLevel = "INFO" | "WARN" | "ERROR" | "FATAL";

export interface SystemLog {
  id: string;
  timestamp: string;
  logLevel: SystemLogLevel;
  serviceName: string;
  message: string;
}

export interface SystemTelemetry {
  cpuUsage: number;
  ramUsage: { percentage: number; usedGb: number; totalGb: number };
  diskIO: number;
  networkIO: { inboundKbps: number; outboundKbps: number };
}

export interface SystemLogsTelemetryPanelProps {
  logs: SystemLog[];
  isStreamActive: boolean;
  onRequestFlip: () => void;
  className?: string;
}
