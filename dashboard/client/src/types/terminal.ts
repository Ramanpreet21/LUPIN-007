/**
 * LUMA GLASS DESIGN REMINDER
 * The terminal stays transport-neutral: data and events arrive only through
 * this contract, leaving the rounded glass canvas presentation pure.
 */
export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export interface UseTerminalStreamReturn {
  incomingData: string | null;
  connectionStatus: "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "ERROR";
  sendData: (data: string) => void;
  sendResize: (dimensions: TerminalDimensions) => void;
}

export interface LiveTerminalProps {
  stream: UseTerminalStreamReturn;
  options?: {
    fontSize?: number;
    fontFamily?: string;
    theme?: Record<string, string>;
  };
  className?: string;
}
