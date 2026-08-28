/**
 * LUMA GLASS DESIGN REMINDER
 * This bounded mock stream intentionally stops its timer while the back face
 * is hidden, matching the lifecycle contract for future network transports.
 */
import { useEffect, useRef, useState } from "react";
import type { SystemLog, SystemTelemetry } from "@/types/system-telemetry";

const MAX_LOG_ITEMS = 500;

const initialLogs: SystemLog[] = [
  { id: "boot-01", timestamp: "2026-08-25T10:14:02.000Z", logLevel: "INFO", serviceName: "relay-core", message: "System health baseline acquired" },
  { id: "boot-02", timestamp: "2026-08-25T10:14:10.000Z", logLevel: "INFO", serviceName: "edge-router", message: "Inbound route table synchronized" },
  { id: "boot-03", timestamp: "2026-08-25T10:14:21.000Z", logLevel: "WARN", serviceName: "archive-sync", message: "One replication job deferred" },
];

const streamEvents: Omit<SystemLog, "id" | "timestamp">[] = [
  { logLevel: "INFO", serviceName: "relay-core", message: "Heartbeat acknowledged by relay-04" },
  { logLevel: "INFO", serviceName: "event-store", message: "Event segment flushed in 4ms" },
  { logLevel: "WARN", serviceName: "archive-sync", message: "Cold path queue remains within threshold" },
  { logLevel: "ERROR", serviceName: "edge-router", message: "Transient upstream retry recovered" },
];

const telemetryFrames: SystemTelemetry[] = [
  { cpuUsage: 36, ramUsage: { percentage: 54, usedGb: 8.6, totalGb: 16 }, diskIO: 12.4, networkIO: { inboundKbps: 840, outboundKbps: 260 } },
  { cpuUsage: 48, ramUsage: { percentage: 58, usedGb: 9.2, totalGb: 16 }, diskIO: 18.1, networkIO: { inboundKbps: 1120, outboundKbps: 340 } },
  { cpuUsage: 67, ramUsage: { percentage: 63, usedGb: 10.1, totalGb: 16 }, diskIO: 21.8, networkIO: { inboundKbps: 960, outboundKbps: 300 } },
  { cpuUsage: 42, ramUsage: { percentage: 57, usedGb: 9.1, totalGb: 16 }, diskIO: 15.2, networkIO: { inboundKbps: 760, outboundKbps: 230 } },
];

export function useMockSystemTelemetryStream(isActive: boolean) {
  const [logs, setLogs] = useState<SystemLog[]>(initialLogs);
  const [telemetry, setTelemetry] = useState<SystemTelemetry>(telemetryFrames[0]);
  const tickRef = useRef(0);

  useEffect(() => {
    if (!isActive) return;

    const timer = window.setInterval(() => {
      const tick = tickRef.current;
      const event = streamEvents[tick % streamEvents.length];
      const nextTelemetry = telemetryFrames[tick % telemetryFrames.length];
      const timestamp = new Date().toISOString();

      setTelemetry(nextTelemetry);
      setLogs((current) => [...current, { ...event, id: `stream-${tick}`, timestamp }].slice(-MAX_LOG_ITEMS));
      tickRef.current += 1;
    }, 3200);

    return () => window.clearInterval(timer);
  }, [isActive]);

  return { logs, telemetry };
}
