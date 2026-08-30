import { useEffect, useState, useCallback } from "react";
import { GalleryVerticalEnd } from "lucide-react";

const API = import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";

interface Session {
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
  const [sessions, setSessions] = useState<Session[]>([]);

  const fetchSessions = useCallback(() => {
    void fetch(`${API}/api/sessions?limit=20`)
      .then((r) => r.json())
      .then((d: { data: Session[] }) => {
        if (Array.isArray(d?.data)) {
          setSessions(d.data);
        }
      })
      .catch(() => {});
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

  if (sessions.length === 0) return null;

  return (
    <div className={className}>
      <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-white/30 font-medium">
        Sessions
      </div>
      <div className="space-y-0.5 px-1">
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelectSession?.(s.id)}
            className="w-full text-left px-2 py-1.5 rounded text-xs text-white/60 hover:text-white/90 hover:bg-white/5 transition-colors truncate flex items-center gap-2"
          >
            <GalleryVerticalEnd className="h-3 w-3 shrink-0 text-white/30" />
            <span className="truncate">{s.summary ?? `Session ${s.id.slice(0, 8)}`}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
