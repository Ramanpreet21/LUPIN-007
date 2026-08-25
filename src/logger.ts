import pino from "pino";

export type Logger = pino.Logger;

/** Structured JSON logger shared across modules (pino). */
export function createLogger(level: string): Logger {
  return pino({ level, base: { pid: process.pid } });
}
