/**
 * LUMA GLASS DESIGN REMINDER
 * Mock transport owns ANSI fixture and command behavior; LiveTerminal itself
 * performs no command parsing and can be replaced by WebSocket/SSE transport.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalDimensions, UseTerminalStreamReturn } from "@/types/terminal";

const ansi = { mint: "\x1b[38;5;121m", amber: "\x1b[38;5;221m", red: "\x1b[38;5;203m", muted: "\x1b[38;5;245m", reset: "\x1b[0m" };

function replyFor(command: string) {
  if (command === "clear") return "\x1b[2J\x1b[H";
  if (command === "status") return `${ansi.mint}[OK]${ansi.reset} edge-router   12ms\r\n${ansi.mint}[OK]${ansi.reset} event-store   4ms\r\n${ansi.amber}[WARN]${ansi.reset} archive sync  1 queued\r\n`;
  if (command === "journalctl -f") return `${ansi.muted}following journal stream…${ansi.reset}\r\n${ansi.mint}[OK]${ansi.reset} heartbeat received from relay-04\r\n`;
  return `${ansi.red}[FAIL]${ansi.reset} command not found: ${command}\r\n`;
}

export function useMockTerminalStream(): UseTerminalStreamReturn {
  const [incomingData, setIncomingData] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<UseTerminalStreamReturn["connectionStatus"]>("CONNECTING");
  const commandBuffer = useRef("");
  const dimensions = useRef<TerminalDimensions>({ cols: 0, rows: 0 });

  const emit = useCallback((data: string) => setIncomingData(data), []);
  useEffect(() => {
    const connect = window.setTimeout(() => {
      setConnectionStatus("CONNECTED");
      emit(`${ansi.mint}luma@relay-04${ansi.reset}:${ansi.muted}~${ansi.reset}$ journalctl -f\r\n`);
    }, 200);
    const pulse = window.setInterval(() => emit(`${ansi.muted}${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}${ansi.reset} ${ansi.mint}[OK]${ansi.reset} stream pulse · node relay-04\r\n`), 5200);
    return () => { window.clearTimeout(connect); window.clearInterval(pulse); setConnectionStatus("DISCONNECTED"); };
  }, [emit]);

  const sendData = useCallback((data: string) => {
    if (data === "\r") {
      const command = commandBuffer.current.trim();
      commandBuffer.current = "";
      emit(`\r\n${replyFor(command)}${ansi.mint}luma@relay-04${ansi.reset}:${ansi.muted}~${ansi.reset}$ `);
    } else if (data === "\u007f") {
      commandBuffer.current = commandBuffer.current.slice(0, -1);
      emit("\b \b");
    } else {
      commandBuffer.current += data;
      emit(data);
    }
  }, [emit]);
  const sendResize = useCallback((next: TerminalDimensions) => { dimensions.current = next; }, []);
  return { incomingData, connectionStatus, sendData, sendResize };
}
