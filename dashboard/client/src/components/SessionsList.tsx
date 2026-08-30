import { useEffect, useState, useCallback } from "react";
import { GalleryVerticalEnd, Clock } from "lucide-react";

const API = import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";

export interface SessionItem {
  id: string;
  thread_id: string | null;
  incident_id: string | null;
  summary: string | null;
  created_at: string;
}

interface SessionsListProps {
  onSelectSession?: (sessionId: string) => void;
  className?: string;
}

export function SessionsList({ onSelectSession, className }: SessionsListProps) {
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
        <span className="text-[9px] text-white/30">{sessions.length}</span>
      </div>
      <div className="space-y-1 px-1.5 max-h-48 overflow-y-auto scrollbar-thin">
        {sessions.map((s) => {
          const formattedTime = s.created_at
            ? new Date(s.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "";
          return (
            <button
              key={s.id}
              onClick={() => onSelectSession?.(s.id)}
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors truncate flex flex-col gap-0.5 border border-transparent hover:border-white/10 group"
            >
              <span className="truncate font-medium text-white/90 group-hover:text-emerald-300">
                {s.summary || `Session ${s.id.slice(0, 8)}`}
              </span>
              <div className="flex items-center gap-1.5 text-[9px] text-white/40 font-mono">
                <Clock size={9} />
                <span>{formattedTime || s.id.slice(0, 8)}</span>
                {s.incident_id && <span className="text-amber-400/60 font-mono">· {s.incident_id}</span>}
              </div>
            </button>
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
