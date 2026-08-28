import { describe, expect, it } from "vitest";
import { nextTerminalDelta } from "./useControlPlaneTerminalStream";

// Mirrors MAX_TERMINAL_CHARS in useControlPlane.ts so the test exercises the
// same cap that triggers transcript prefix rotation.
const MAX = 12_000;

/** Appends chunks the same way the plane does and returns the bounded view. */
function append(parts: string[]): { transcript: string; logicalEnd: number } {
  let logicalEnd = 0;
  let transcript = "";
  for (const part of parts) {
    logicalEnd += part.length;
    transcript = `${transcript}${part}`.slice(-MAX);
  }
  return { transcript, logicalEnd };
}

describe("nextTerminalDelta", () => {
  it("emits only the newly appended suffix across a transcript rotation", () => {
    // First event fills the cap; it is delivered whole.
    const full = append(["a".repeat(MAX)]);
    const d1 = nextTerminalDelta(full.transcript, full.logicalEnd, 0);
    expect(d1.incomingData).toBe(full.transcript);

    // Second event pushes the transcript over the cap: the prefix rotates.
    const rotated = append(["a".repeat(MAX), "b".repeat(100)]);
    const d2 = nextTerminalDelta(rotated.transcript, rotated.logicalEnd, d1.delivered);
    // Rotation must NOT re-emit the ~12k retained tail — only the new 100 chars.
    expect(d2.incomingData).toBe("b".repeat(100));

    // A later ordinary append keeps delivering just its own suffix.
    const grown = append(["a".repeat(MAX), "b".repeat(100), "c".repeat(20)]);
    const d3 = nextTerminalDelta(grown.transcript, grown.logicalEnd, d2.delivered);
    expect(d3.incomingData).toBe("c".repeat(20));
  });

  it("stays silent when nothing new was appended", () => {
    const initial = append(["hello"]);
    const d1 = nextTerminalDelta(initial.transcript, initial.logicalEnd, 0);
    expect(d1.incomingData).toBe("hello");
    const d2 = nextTerminalDelta(initial.transcript, initial.logicalEnd, d1.delivered);
    expect(d2.incomingData).toBeNull();
  });

  it("delivers an over-cap single event exactly once", () => {
    const over = append(["x".repeat(MAX + 123)]);
    const d = nextTerminalDelta(over.transcript, over.logicalEnd, 0);
    expect(d.incomingData).toBe(over.transcript);
    expect(d.incomingData!.length).toBe(MAX);
  });
});
