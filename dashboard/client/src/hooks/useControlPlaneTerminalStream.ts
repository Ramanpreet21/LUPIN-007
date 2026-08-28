import { useCallback, useMemo, useRef } from "react";
import type { UseControlPlaneReturn } from "@/hooks/useControlPlane";
import type { UseTerminalStreamReturn } from "@/types/terminal";

/**
 * Live terminal transport (blueprint §7): adapts the incident-plane WebSocket
 * feed to the transport-neutral terminal contract. Keyboard and resize have no
 * upstream channel on the control plane yet, so they stay inert — the terminal
 * is a read-only diagnostic stream.
 */
export function useControlPlaneTerminalStream(
  plane: UseControlPlaneReturn,
): UseTerminalStreamReturn {
  const sendData = useCallback(() => {}, []);
  const sendResize = useCallback(() => {}, []);
  // Track the transcript prefix already handed to the terminal so a burst
  // flushed in one render still delivers every event, not only the last slot.
  const lastTranscriptRef = useRef("");
  return useMemo<UseTerminalStreamReturn>(() => {
    const transcript = plane.terminalChunk;
    const last = lastTranscriptRef.current;
    let incomingData: string | null = null;
    if (transcript !== last) {
      if (transcript.length > last.length && transcript.startsWith(last)) {
        incomingData = transcript.slice(last.length);
      } else {
        // Transcript was capped (rotation) or reset: emit the current tail once.
        incomingData = transcript;
      }
      lastTranscriptRef.current = transcript;
    }
    return {
      incomingData,
      connectionStatus: plane.status,
      sendData,
      sendResize,
    };
  }, [plane.terminalChunk, plane.status, sendData, sendResize]);
}
