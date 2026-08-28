/**
 * LUMA GLASS DESIGN REMINDER
 * Pure rounded terminal canvas. The stream prop is the only transport seam.
 */
import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { LiveTerminalProps } from "@/types/terminal";

const labels = { CONNECTING: "connecting", CONNECTED: "live", DISCONNECTED: "offline", ERROR: "error" } as const;

export function LiveTerminal({ stream, options, className = "" }: LiveTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const pendingOutputRef = useRef<string[]>([]);
  const outputFrameRef = useRef<number | null>(null);
  const lastReportedDimensionsRef = useRef("");
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: options?.fontSize ?? 10,
      fontFamily: options?.fontFamily ?? '"DM Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      lineHeight: 1.22,
      scrollback: 240,
      theme: { background: "#0c1114", foreground: "#d9e8e1", cursor: "#baffea", selectionBackground: "#78dcb055", black: "#101619", brightBlack: "#697772", green: "#7df0c8", brightGreen: "#baffea", yellow: "#f9c76d", brightYellow: "#ffe2a5", red: "#ff7880", brightRed: "#ffb1ac", ...options?.theme },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminalRef.current = terminal;
    lastReportedDimensionsRef.current = "";
    const resize = () => {
      try {
        fit.fit();
        const dimensions = `${terminal.cols}x${terminal.rows}`;
        if (dimensions !== lastReportedDimensionsRef.current) {
          lastReportedDimensionsRef.current = dimensions;
          stream.sendResize({ cols: terminal.cols, rows: terminal.rows });
        }
      } catch {
        /* hidden container reflow */
      }
    };
    const frame = window.requestAnimationFrame(resize);
    const observer = new ResizeObserver(resize);
    observer.observe(container.parentElement ?? container);
    const input = terminal.onData((data) => stream.sendData(data));
    return () => { window.cancelAnimationFrame(frame); input.dispose(); observer.disconnect(); terminal.dispose(); terminalRef.current = null; };
  }, [options?.fontFamily, options?.fontSize, options?.theme, stream.sendData, stream.sendResize]);
  useEffect(() => {
    if (!stream.incomingData) return;
    pendingOutputRef.current.push(stream.incomingData);
    if (outputFrameRef.current !== null) return;

    outputFrameRef.current = window.requestAnimationFrame(() => {
      outputFrameRef.current = null;
      const output = pendingOutputRef.current.join("");
      pendingOutputRef.current = [];
      terminalRef.current?.write(output);
    });
  }, [stream.incomingData]);

  useEffect(() => () => {
    if (outputFrameRef.current !== null) window.cancelAnimationFrame(outputFrameRef.current);
  }, []);
  const tone = stream.connectionStatus.toLowerCase();
  return <article className={`terminal-module glass-surface ${className}`.trim()} aria-label="Live diagnostic terminal"><div className="module-heading terminal-heading"><p className="eyebrow">Diagnostic stream</p><span className={`terminal-status terminal-status--${tone}`}><i />{labels[stream.connectionStatus]}</span></div><div ref={containerRef} className="terminal-canvas" aria-label="Interactive system terminal" /></article>;
}
