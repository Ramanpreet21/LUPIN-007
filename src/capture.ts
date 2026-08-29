import type { NormalizedAlert } from "./incidents";
import { execReadOnly, type ReadOnlyExecutor } from "./exec-readonly";

interface SnapshotJob {
  label: string;
  command: string;
  args: string[];
}

/**
 * Read-only host snapshots taken right before a sandbox session starts (5c).
 * Commands run without a shell via the same executor the local MCP provider
 * uses (5b). Every failure renders `(unavailable)`; capture never fails the
 * alert — a missing binary or a locked shell must not take down the incident.
 */
export async function captureTargetState(
  alert: NormalizedAlert,
  executor: ReadOnlyExecutor = execReadOnly,
): Promise<string> {
  const jobs: SnapshotJob[] = [
    { label: "Processes", command: "ps", args: ["aux", "--forest"] },
    { label: "Network connections", command: "ss", args: ["-tulnp"] },
    { label: "Disk usage", command: "df", args: ["-h"] },
    { label: "Memory usage", command: "free", args: ["-m"] },
  ];
  if (alert.service_name) {
    jobs.push({
      label: `Service status (${alert.service_name})`,
      command: "systemctl",
      args: ["status", alert.service_name, "--no-pager", "--lines=40"],
    });
  }

  const parts = await Promise.all(
    jobs.map(async ({ label, command, args }) => {
      try {
        const { stdout } = await executor(command, args);
        return `${label}:\n${stdout.trim() || "(no output)"}`;
      } catch {
        return `${label}: (unavailable)`;
      }
    }),
  );

  return [
    "## CAPTURED SYSTEM STATE (snapshot at alert time)",
    `host=${alert.target_host}`,
    "",
    ...parts.join("\n\n").split("\n"),
  ].join("\n");
}
