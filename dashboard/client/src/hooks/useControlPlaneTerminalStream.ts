import { useCallback, useMemo, useRef } from "react";
import type { UseControlPlaneReturn } from "@/hooks/useControlPlane";
import type { UseTerminalStreamReturn } from "@/types/terminal";

/**
 * Live terminal transport (blueprint §7): adapts the incident-plane WebSocket
 * feed to the transport-neutral terminal contract. Keyboard and resize have no
 * upstream channel on the control plane yet, so they stay inert — the terminal
 * is a read-only diagnostic stream.
 */

/**
 * Pure delta over the bounded incident-plane transcript. The plane caps the
 * transcript prefix at MAX_TERMINAL_CHARS, so comparing prefixes cannot tell a
 * rotation from a reset — that fallback re-rendered the whole retained tail.
 * The monotonic logical cursor stays valid across rotation; only the newly
 * appended suffix is returned, exactly once.
 */
export function nextTerminalDelta(
  transcript: string,
  logicalEnd: number,
  delivered: number,
): { incomingData: string | null; delivered: number } {
  if (logicalEnd <= delivered) return { incomingData: null, delivered };
  const windowStart = logicalEnd - transcript.length;
  const unrendered = Math.max(delivered, windowStart);
  if (unrendered >= logicalEnd) return { incomingData: null, delivered };
  return {
    incomingData: transcript.slice(unrendered - windowStart),
    delivered: logicalEnd,
  };
}

export function useControlPlaneTerminalStream(
  plane: UseControlPlaneReturn,
): UseTerminalStreamReturn {
  const deliveredRef = useRef<number>(plane.terminalCursor);
  const sendData = useCallback(() => {}, []);
  const sendResize = useCallback(() => {}, []);

  const delta = useMemo(() => {
    const result = nextTerminalDelta(
      plane.terminalChunk,
      plane.terminalCursor,
      deliveredRef.current,
    );
    deliveredRef.current = result.delivered;
    return result.incomingData;
  }, [plane.terminalChunk, plane.terminalCursor]);

  return useMemo<UseTerminalStreamReturn>(
    () => ({
      incomingData: delta,
      transcript: plane.terminalChunk,
      terminalCursor: plane.terminalCursor,
      connectionStatus: plane.status,
      sendData,
      sendResize,
    }),
    [delta, plane.terminalChunk, plane.terminalCursor, plane.status, sendData, sendResize],
  );
}
