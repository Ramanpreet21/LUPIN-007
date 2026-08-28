/**
 * LUMA GLASS DESIGN REMINDER
 * Back face of the health card. Local filter and scroll states remain mounted
 * across flips; incoming stream data is supplied exclusively through props.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Pause, Play, Search, X } from "lucide-react";
import type { SystemLog, SystemLogLevel, SystemLogsTelemetryPanelProps } from "@/types/system-telemetry";

const levels: SystemLogLevel[] = ["INFO", "WARN", "ERROR", "FATAL"];

function highlightMessage(message: string, query: string) {
  if (!query) return message;
  const matcher = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
  return message.split(matcher).map((part, index) => part.toLowerCase() === query.toLowerCase() ? <mark key={`${part}-${index}`}>{part}</mark> : part);
}

export function SystemLogsTelemetryPanel({ logs, isStreamActive, onRequestFlip, className = "" }: SystemLogsTelemetryPanelProps) {
  const [activeLevels, setActiveLevels] = useState<Set<SystemLogLevel>>(() => new Set(levels));
  const [activeService, setActiveService] = useState("all");
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const logBodyRef = useRef<HTMLDivElement>(null);
  const services = useMemo(() => ["all", ...Array.from(new Set(logs.map((log) => log.serviceName)))], [logs]);
  const visibleLogs = useMemo(() => logs.filter((log) => activeLevels.has(log.logLevel) && (activeService === "all" || log.serviceName === activeService) && `${log.serviceName} ${log.message}`.toLowerCase().includes(query.toLowerCase())), [activeLevels, activeService, logs, query]);

  useEffect(() => {
    if (!isStreamActive || !autoScroll) return;
    const body = logBodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [autoScroll, isStreamActive, visibleLogs]);

  const trap = (event: React.SyntheticEvent) => event.stopPropagation();
  const toggleLevel = (level: SystemLogLevel) => {
    setActiveLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level); else next.add(level);
      return next;
    });
  };

  return (
    <article className={`health-flip-face health-flip-back health-telemetry-panel signal-module ${className}`.trim()} onClick={trap} aria-label="System logs">
      <div className="health-back-header">
        <div><p className="eyebrow">System logs</p><span>{isStreamActive ? "stream active" : "stream paused"}</span></div>
        <button className="health-flip-button" type="button" onClick={(event) => { trap(event); onRequestFlip(); }} aria-label="Return to system health summary"><ArrowLeft size={14} /></button>
      </div>

      <div className="log-controls" onClick={trap}>
        <div className="log-search"><Search size={11} /><input value={query} onChange={(event) => setQuery(event.target.value)} onClick={trap} placeholder="Search logs" aria-label="Search logs" />{query && <button type="button" onClick={(event) => { trap(event); setQuery(""); }} aria-label="Clear log search"><X size={10} /></button>}</div>
        <button className={`log-pause ${autoScroll ? "is-live" : ""}`} type="button" onClick={(event) => { trap(event); setAutoScroll((value) => !value); }}><span>{autoScroll ? "Pause" : "Auto"}</span>{autoScroll ? <Pause size={10} /> : <Play size={10} />}</button>
      </div>

      <div className="log-filter-row" onClick={trap}>
        {levels.map((level) => <button key={level} type="button" className={`log-filter log-filter--${level.toLowerCase()} ${activeLevels.has(level) ? "is-active" : ""}`} onClick={(event) => { trap(event); toggleLevel(level); }}>{level}</button>)}
        <select value={activeService} onChange={(event) => setActiveService(event.target.value)} onClick={trap} aria-label="Filter logs by service">{services.map((service) => <option key={service} value={service}>{service}</option>)}</select>
      </div>

      <div ref={logBodyRef} className="log-terminal" onClick={trap}>
        {visibleLogs.map((log: SystemLog) => <div key={log.id} className={`log-line log-line--${log.logLevel.toLowerCase()}`}><time>{new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><b>{log.logLevel}</b><span>{log.serviceName}</span><p>{highlightMessage(log.message, query)}</p></div>)}
        {visibleLogs.length === 0 && <div className="log-empty">No matching stream entries</div>}
      </div>
    </article>
  );
}
