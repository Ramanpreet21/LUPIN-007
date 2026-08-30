import { useEffect, useState, useCallback } from "react";
import { GalleryVerticalEnd, Clock, Plus, Trash2 } from "lucide-react";

const API =
  import.meta.env.VITE_CONTROL_PLANE_ORIGIN ??
  (typeof window !== "undefined" && (window.location.port === "3000" || !window.location.port)
    ? ""
    : "http://localhost:3001");

export interface SessionItem {
  id: string;
  thread_id: string | null;
  incident_id: string | null;
  summary: string | null;
  created_at: string;
}

interface SessionsListProps {
  selectedSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onCreateSession?: () => void;
  onDeleteSession?: (sessionId: string) => void;
  className?: string;
}

export function SessionsList({
  selectedSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  className,
}: SessionsListProps) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(() => {
    void fetch(`${API}/api/sessions?limit=20`)
      .then((r) => r.json())
      .then((d: { data: SessionItem[] }) => {
        if (Array.isArray(d?.data)) {
          setSessions(d.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setSessions((prev) => prev.filter((s) => s.id !== id));
      try {
        await fetch(`${API}/api/sessions/${id}`, { method: "DELETE" });
        onDeleteSession?.(id);
      } catch (err) {
        console.error("Failed to delete session:", err);
      }
    },
    [onDeleteSession],
  );

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    const handleSessionCreated = () => {
      fetchSessions();
    };
    window.addEventListener("session_created", handleSessionCreated);
    return () => window.removeEventListener("session_created", handleSessionCreated);
  }, [fetchSessions]);

  return (
    <div className={`sessions-rail-section ${className || ""}`.trim()}>
      <div className="flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-widest text-white/40 font-mono font-medium">
        <span className="flex items-center gap-1.5">
          <GalleryVerticalEnd size={11} className="text-emerald-400/80" />
          Sessions
        </span>
        <div className="flex items-center gap-2">
          {onCreateSession && (
            <button
              type="button"
              onClick={onCreateSession}
              className="flex items-center gap-1 text-[9px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10 px-1.5 py-0.5 rounded transition-colors"
              title="Start new conversation session"
            >
              <Plus size={10} />
              <span>New</span>
            </button>
          )}
          <span className="text-[9px] text-white/30">{sessions.length}</span>
        </div>
      </div>
      <div className="space-y-1 px-1.5 max-h-48 overflow-y-auto scrollbar-thin">
        {sessions.map((s) => {
          const isSelected = selectedSessionId === s.id;
          const formattedTime = s.created_at
            ? new Date(s.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "";
          return (
            <div
              key={s.id}
              onClick={() => onSelectSession?.(s.id)}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors truncate flex flex-col gap-0.5 border group relative cursor-pointer ${
                isSelected
                  ? "bg-emerald-400/15 border-emerald-400/30 text-emerald-200 shadow-[0_0_12px_rgba(108,243,201,0.12)]"
                  : "text-white/70 hover:text-white hover:bg-white/10 border-transparent hover:border-white/10"
              }`}
            >
              <div className="flex items-center justify-between gap-1 w-full">
                <span className={`truncate font-medium flex-1 ${isSelected ? "text-emerald-300" : "text-white/90 group-hover:text-emerald-300"}`}>
                  {s.summary || `Session ${s.id.slice(0, 8)}`}
                </span>
                <button
                  type="button"
                  onClick={(e) => void handleDelete(e, s.id)}
                  className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 hover:bg-red-400/10 p-0.5 rounded transition-all"
                  title="Delete session"
                >
                  <Trash2 size={11} />
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-[9px] text-white/40 font-mono">
                <Clock size={9} />
                <span>{formattedTime || s.id.slice(0, 8)}</span>
                {s.incident_id && <span className="text-amber-400/60 font-mono">· {s.incident_id}</span>}
              </div>
            </div>
          );
        })}
        {sessions.length === 0 && (
          <div className="px-2.5 py-3 text-[11px] text-white/30 italic text-center rounded-lg bg-white/[0.02] border border-white/5">
            {loading ? "Loading sessions…" : "No active sessions yet"}
          </div>
        )}
      </div>
    </div>
  );
}
