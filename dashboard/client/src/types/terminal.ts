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
  /** Latest bounded transcript window (the transport may rotate the prefix at a cap). */
  transcript: string;
  /** Monotonic count of transcript characters appended so far; never decreases. */
  terminalCursor: number;
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
