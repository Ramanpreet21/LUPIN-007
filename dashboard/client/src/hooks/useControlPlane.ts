import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApprovalDecision,
  ControlPlaneConnectionStatus,
  ControlPlaneEvent,
  DeckIncident,
  ExecutionStatus,
  IncidentDeckStatus,
} from "@/types/control-plane";

export const CONTROL_PLANE_ORIGIN =
  import.meta.env.VITE_CONTROL_PLANE_ORIGIN ??
  (typeof window !== "undefined" && (window.location.port === "3000" || !window.location.port)
    ? ""
    : "http://localhost:3001");

export const CONTROL_PLANE_WS =
  import.meta.env.VITE_CONTROL_PLANE_WS ??
  (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
    : "ws://localhost:3001/ws");

/** Bounds for the live incident list, per-incident thinking buffer, and terminal transcript. */
const MAX_INCIDENTS = 48;
const MAX_THINKING_LINES = 40;
const MAX_TERMINAL_CHARS = 12_000;

const EXECUTION_TO_DECK: Record<ExecutionStatus, IncidentDeckStatus> = {
  success: "completed",
  failed: "failed",
  rejected: "rejected",
};

const ansi = {
  mint: "\x1b[38;5;121m",
  amber: "\x1b[38;5;221m",
  red: "\x1b[38;5;203m",
  muted: "\x1b[38;5;245m",
  reset: "\x1b[0m",
};

/** upsert an incident row; new incidents land first (newest → oldest). */
function upsertIncident(
  rows: DeckIncident[],
  incidentId: string,
  update: (row: DeckIncident) => DeckIncident,
): DeckIncident[] {
  const index = rows.findIndex((row) => row.incident_id === incidentId);
  if (index === -1) {
    return [
      update({ incident_id: incidentId, status: "diagnosing", thinking: [], pending: null }),
      ...rows,
    ].slice(0, MAX_INCIDENTS);
  }
  return rows.map((row, i) => (i === index ? update(row) : row));
}

/** Is the plane actively working an incident? True during diagnosis and through
 * the operator-approved window (decide() moves a row to `approved` before the
 * execution_complete event finalizes it). */
export function isPlaneExecuting(rows: DeckIncident[]): boolean {
  return rows.some((row) => row.status === "diagnosing" || row.status === "approved");
}

/** Executions rejected or failed this session (live policy-block proxy). */
export function countBlockedExecutions(rows: DeckIncident[]): number {
  return rows.filter((row) => row.status === "rejected" || row.status === "failed").length;
}

/** One ANSI display chunk for the diagnostic terminal per WS event. */
function terminalChunkFor(event: ControlPlaneEvent): string {
  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const stamp = `${ansi.muted}${time}${ansi.reset}`;
  switch (event.type) {
    case "incident_created":
      return `\r\n${stamp} ${ansi.mint}[INCIDENT]${ansi.reset} ${event.incident_id} · diagnosing\r\n`;
    case "agent_thinking": {
      const content = String(event.payload.content ?? "").trim();
      if (!content) return `\r\n${stamp} ${ansi.mint}${event.incident_id}${ansi.reset} · step ${event.payload.step}\r\n`;
      return `\r\n${stamp} ${ansi.mint}${event.incident_id}${ansi.reset} · step ${event.payload.step}\r\n${content}\r\n`;
    }
    case "pending_approval": {
      const commands = (Array.isArray(event.payload.proposed_commands) ? event.payload.proposed_commands : []).join(" && ");
      return `\r\n${stamp} ${ansi.amber}[APPROVAL REQUIRED]${ansi.reset} ${event.incident_id}\r\n  ${commands}\r\n`;
    }
    case "execution_complete": {
      const status = event.payload.status ?? "unknown";
      const color = status === "success" ? ansi.mint : status === "rejected" ? ansi.amber : ansi.red;
      return `\r\n${stamp} ${color}[EXEC ${String(status).toUpperCase()}]${ansi.reset} ${event.incident_id}\r\n`;
    }
    default:
      const eventType = String((event as { type?: string }).type ?? "unknown");
      return `\r\n${stamp} ${ansi.muted}[EVENT ${eventType}]${ansi.reset}\r\n`;
  }
}

export interface UseControlPlaneOptions {
  /** Called for each streamed token during a conversation turn. */
  onConverseThinking?: (content: string, step: number) => void;
  /** Called when a conversation turn completes or errors. */
  onConverseComplete?: (content: string, status: "done" | "failed") => void;
  /** Called when a fleet host probe update event is received. */
  onFleetUpdated?: (hostId: string, payload: { status: string; latency_ms: number }) => void;
}

export interface UseControlPlaneReturn {
  status: ControlPlaneConnectionStatus;
  /** Live incidents, newest first. */
  incidents: DeckIncident[];
  /** Cumulative incident-plane transcript rendered for the diagnostic terminal. */
  terminalChunk: string;
  /** Monotonic count of transcript characters appended so far (never decreases). */
  terminalCursor: number;
  /** True while the plane is working an incident (live executing signal). */
  isExecuting: boolean;
  /** Executions rejected or failed this session (live policy-block proxy). */
  blockedExecutionCount: number;
  /** Most recent sandbox.created relay (null until a sandbox starts). */
  sandbox: { incident_id: string; sandbox_id: string; created_at: string } | null;
  /** POST an operator decision to /api/approvals; rejects on non-2xx. */
  approve: (incidentId: string) => Promise<void>;
  reject: (incidentId: string) => Promise<void>;
  /** POST a freeform message to /converse; streams back via WebSocket callbacks. */
  converse: (message: string, sessionId?: string) => Promise<{ status: string; session_id?: string }>;
}

/**
 * Live transport for the operator console (blueprint §7): owns the WebSocket
 * to the incident plane, keeps an incident deck in sync, and relays operator
 * decisions to the approval route. Reconnects with backoff; nulls out on unmount.
 */
export function useControlPlane(opts: UseControlPlaneOptions = {}): UseControlPlaneReturn {
  const { onConverseThinking, onConverseComplete, onFleetUpdated } = opts;
  const [status, setStatus] = useState<ControlPlaneConnectionStatus>("CONNECTING");
  const [incidents, setIncidents] = useState<DeckIncident[]>([]);
  const [terminalChunk, setTerminalChunk] = useState("");
  // Monotonic count of transcript characters appended to the bounded window.
  const terminalCursorRef = useRef(0);
  const [activeSandbox, setActiveSandbox] = useState<{ incident_id: string; sandbox_id: string; created_at: string } | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptsRef = useRef(0);
  const disposedRef = useRef(false);
  const onConverseThinkingRef = useRef(onConverseThinking);
  const onConverseCompleteRef = useRef(onConverseComplete);
  const onFleetUpdatedRef = useRef(onFleetUpdated);

  // Keep refs current so closures inside handleEvent always call the latest version
  useEffect(() => {
    onConverseThinkingRef.current = onConverseThinking;
  }, [onConverseThinking]);
  useEffect(() => {
    onConverseCompleteRef.current = onConverseComplete;
  }, [onConverseComplete]);
  useEffect(() => {
    onFleetUpdatedRef.current = onFleetUpdated;
  }, [onFleetUpdated]);

  const handleEvent = useCallback((raw: string) => {
    let event: ControlPlaneEvent;
    try {
      event = JSON.parse(raw) as ControlPlaneEvent;
    } catch {
      return;
    }
    if (!event || typeof event !== "object" || typeof event.type !== "string") return;

    // Handle converse events (session_id, not incident_id)
    if (event.type === "converse_thinking") {
      onConverseThinkingRef.current?.(String(event.payload.content ?? ""), Number(event.payload.step ?? 0));
      return;
    }
    if (event.type === "converse_complete") {
      onConverseCompleteRef.current?.(
        String(event.payload.content ?? ""),
        event.payload.status === "done" ? "done" : "failed",
      );
      return;
    }

    if (event.type === "fleet_updated") {
      onFleetUpdatedRef.current?.(event.host_id, event.payload);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("fleet_updated", { detail: event }));
      }
      return;
    }

    if (event.type === "session_created") {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("session_created", { detail: event }));
      }
      return;
    }

    // Incident events need incident_id
    if (typeof event.incident_id !== "string") return;
    if (!event.payload || typeof event.payload !== "object") return;

    switch (event.type) {
      case "incident_created":
        setIncidents((rows) =>
          upsertIncident(rows, event.incident_id, (row) => ({ ...row, status: "diagnosing" })),
        );
        break;
      case "agent_thinking": {
        const content = String(event.payload.content ?? "").trim();
        if (content) {
          setIncidents((rows) =>
            upsertIncident(rows, event.incident_id, (row) => ({
              ...row,
              status: row.status === "awaiting_approval" ? row.status : "diagnosing",
              thinking: [...row.thinking, content].slice(-MAX_THINKING_LINES),
            })),
          );
        }
        break;
      }
      case "pending_approval": {
        setIncidents((rows) =>
          upsertIncident(rows, event.incident_id, (row) => ({
            ...row,
            status: "awaiting_approval",
            pending: {
              proposed_command: String(event.payload.proposed_command ?? ""),
              proposed_commands: Array.isArray(event.payload.proposed_commands)
                ? event.payload.proposed_commands.map(String)
                : [],
              safety_badges: Array.isArray(event.payload.safety_badges)
                ? event.payload.safety_badges
                : [],
              diff: String(event.payload.diff ?? ""),
            },
          })),
        );
        break;
      }
      case "execution_complete":
        setIncidents((rows) =>
          upsertIncident(rows, event.incident_id, (row) => ({
            ...row,
            status: EXECUTION_TO_DECK[event.payload.status] ?? "failed",
            pending: null,
          })),
        );
        break;
      case "sandbox_started":
        setActiveSandbox({
          incident_id: event.incident_id,
          sandbox_id: String(event.payload.sandbox_id ?? ""),
          created_at:
            typeof event.payload.created_at === "string"
              ? event.payload.created_at
              : new Date().toISOString(),
        });
        break;
    }

    const chunk = terminalChunkFor(event);
    terminalCursorRef.current += chunk.length;
    setTerminalChunk((prev) => `${prev}${chunk}`.slice(-MAX_TERMINAL_CHARS));
  }, []);

  const connect = useCallback(() => {
    if (disposedRef.current) return;
    socketRef.current?.close();
    setStatus("CONNECTING");
    let socket: WebSocket;
    try {
      socket = new WebSocket(CONTROL_PLANE_WS);
    } catch {
      setStatus("ERROR");
      return;
    }
    socketRef.current = socket;
    socket.onopen = () => {
      attemptsRef.current = 0;
      setStatus("CONNECTED");
    };
    socket.onmessage = (message) => handleEvent(String(message.data));
    socket.onerror = () => {
      /* connection state resolves through onclose */
    };
    socket.onclose = () => {
      if (disposedRef.current) return;
      // A replaced socket's late close must not schedule a second reconnect.
      if (socketRef.current !== socket) return;
      setStatus("DISCONNECTED");
      const delay = Math.min(8000, 500 * 2 ** attemptsRef.current);
      attemptsRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(() => {
        if (!disposedRef.current) connect();
      }, delay);
    };
  }, [handleEvent]);

  useEffect(() => {
    disposedRef.current = false;
    connect();
    return () => {
      disposedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connect]);

  const decide = useCallback(
    async (incidentId: string, decision: ApprovalDecision) => {
      const response = await fetch(`${CONTROL_PLANE_ORIGIN}/api/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id: incidentId, decision }),
      });
      if (!response.ok) {
        throw new Error(`approval request failed (HTTP ${response.status})`);
      }
      // Optimistic: record the operator decision; the follow-up
      // execution_complete event finalizes the incident row.
      setIncidents((rows) =>
        upsertIncident(rows, incidentId, (row) => ({
          ...row,
          status: decision === "approved" ? "approved" : "rejected",
          pending: null,
        })),
      );
    },
    [],
  );

  const converse = useCallback(async (message: string, sessionId?: string): Promise<{ status: string; session_id?: string }> => {
    const response = await fetch(`${CONTROL_PLANE_ORIGIN}/converse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id: sessionId }),
    });
    if (!response.ok) {
      throw new Error(`converse request failed (HTTP ${response.status})`);
    }
    return (await response.json()) as { status: string; session_id?: string };
  }, []);

  const isExecuting = isPlaneExecuting(incidents);
  const blockedExecutionCount = countBlockedExecutions(incidents);
  return {
    status,
    incidents,
    terminalChunk,
    terminalCursor: terminalCursorRef.current,
    isExecuting,
    blockedExecutionCount,
    sandbox: activeSandbox,
    approve: (incidentId) => decide(incidentId, "approved"),
    reject: (incidentId) => decide(incidentId, "rejected"),
    converse,
  };
}
