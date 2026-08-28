import { useCallback, useMemo } from "react";
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
  return useMemo<UseTerminalStreamReturn>(
    () => ({
      incomingData: plane.terminalChunk,
      connectionStatus: plane.status,
      sendData,
      sendResize,
    }),
    [plane.terminalChunk, plane.status, sendData, sendResize],
  );
}
