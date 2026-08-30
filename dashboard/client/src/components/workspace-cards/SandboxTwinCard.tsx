import { Box, CheckCircle2, Cpu, HardDrive, LockKeyhole, Network, Play } from "lucide-react";
import { mergeSandboxStatus, useSandbox } from "@/hooks/useSandbox";
import type { SandboxTwinData, WorkspaceViewProps } from "@/types/workspace-cards";

export interface SandboxTwinCardProps extends WorkspaceViewProps<SandboxTwinData> {
  sandboxId?: string | null;
}

export function SandboxTwinCard({
  context,
  data,
  sandboxId = null,
  onAction,
  className = "",
}: SandboxTwinCardProps) {
  // 5f: poll the sandbox-status REST proxy (TrueForge-backed when reachable) and
  // overlay live metrics on the fixture; the fixture remains the fallback.
  const live = useSandbox(sandboxId);
  const effective = mergeSandboxStatus(data, live);
  const cpuWidth = `${effective.resourceLimits.cpuUsedPercent}%`;
  const memoryWidth = `${Math.round((effective.resourceLimits.memoryUsedMb / effective.resourceLimits.memoryCapMb) * 100)}%`;
  const containerLabel = sandboxId ?? effective.containerId;
  return (
    <section className={`workspace-card sandbox-card ${className}`.trim()} aria-label="Sandbox twin inspector">
      <header className="workspace-card-head">
        <div><p className="eyebrow">{context.targetHostname} · isolated test surface</p><h2>Sandbox twin</h2><span>Trial execution remains sealed from the active production path.</span></div>
        <span className="workspace-card-state"><CheckCircle2 size={13} />{effective.state.replace("_", " ")}</span>
      </header>
      <div className="sandbox-layout">
        <section className="sandbox-identity">
          <span><Box size={22} /></span>
          <div><p className="eyebrow">Rootless container</p><strong>{containerLabel}</strong><small>{sandboxId ? "Live TrueForge sandbox · protected replication" : "Podman twin · protected replication"}</small></div>
          <button type="button" onClick={() => onAction?.("RUN_SANDBOX_TEST", { containerId: effective.containerId })}><Play size={13} />Run test build</button>
        </section>
        <section className="sandbox-resources">
          <div><header><span><Cpu size={13} />CPU allocation</span><strong>{effective.resourceLimits.cpuUsedPercent}%</strong></header><i><b style={{ width: cpuWidth }} /></i><small>{effective.resourceLimits.cpuCapCores} vCPU cap · rootless execution</small></div>
          <div><header><span><HardDrive size={13} />Memory allocation</span><strong>{effective.resourceLimits.memoryUsedMb} MB</strong></header><i><b style={{ width: memoryWidth }} /></i><small>{effective.resourceLimits.memoryCapMb} MB cap · cgroup bounded</small></div>
        </section>
        <section className="sandbox-flags">
          <span className={effective.isolationFlags.networkDisabled ? "is-safe" : "is-warning"}><Network size={13} />Network: {effective.isolationFlags.networkDisabled ? "disabled" : "attached"}</span>
          <span className={effective.isolationFlags.readOnlyHostMount ? "is-safe" : "is-warning"}><LockKeyhole size={13} />Host mount: {effective.isolationFlags.readOnlyHostMount ? "read-only" : "read-write"}</span>
        </section>
        {effective.executionTestResult && <section className={`sandbox-result ${effective.executionTestResult.exitCode === 0 ? "is-success" : "is-failed"}`}><b>EXIT {effective.executionTestResult.exitCode}</b><p>{effective.executionTestResult.outputDiffSummary}</p></section>}
      </div>
    </section>
  );
}
