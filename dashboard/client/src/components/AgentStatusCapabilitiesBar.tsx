import { Ban, Boxes, ChevronDown, Cpu, KeyRound, Radio, ShieldAlert, SlidersHorizontal, TerminalSquare } from "lucide-react";
import type { AgentStatusCapabilitiesBarProps, ApprovalMode, SSHStatus } from "@/types/agent-status";

const sshLabel: Record<SSHStatus, string> = { CONNECTED: "connected", DISCONNECTED: "offline", RECONNECTING: "reconnecting" };
const nextMode = (mode: ApprovalMode): ApprovalMode => mode === "AUTONOMOUS" ? "STRICT_GATED" : "AUTONOMOUS";
const contextTone = (used: number, max: number) => { const percentage = max === 0 ? 0 : used / max * 100; return percentage > 90 ? "critical" : percentage >= 70 ? "warning" : "safe"; };

export function AgentStatusCapabilitiesBar({ data, onToggleApprovalMode, onEmergencyStop, onSSHAction, onSkillClick, hasApiKey, onOpenSettings, className = "" }: AgentStatusCapabilitiesBarProps) {
  const usage = data.telemetry.maxTokens === 0 ? 0 : Math.min(data.telemetry.tokensUsed / data.telemetry.maxTokens * 100, 100);
  const tone = contextTone(data.telemetry.tokensUsed, data.telemetry.maxTokens);
  return <article className={`cutout-card agent-status-bar glass-surface ${className}`.trim()} aria-label="Agent status and capabilities">
    <header className="agent-bar-header">
      <div className="agent-title"><TerminalSquare size={13} /><span>Agent status</span></div>
      <div className="agent-header-actions">
        {hasApiKey === false && (
          <button
            type="button"
            className="agent-apikey-pulse-badge"
            onClick={onOpenSettings}
            title="LLM API Key missing. Click to open Settings."
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 8px",
              borderRadius: "4px",
              background: "rgba(245, 158, 11, 0.2)",
              border: "1px solid rgba(245, 158, 11, 0.6)",
              color: "#fde68a",
              fontSize: "10px",
              fontWeight: 600,
              cursor: "pointer",
              animation: "pulse 1.8s infinite",
            }}
          >
            <KeyRound size={11} style={{ color: "#fbbf24" }} />
            <span>API KEY REQUIRED</span>
          </button>
        )}
        <button className={`agent-approval-switch ${data.safety.approvalMode === "STRICT_GATED" ? "is-gated" : ""}`} type="button" role="switch" aria-checked={data.safety.approvalMode === "STRICT_GATED"} onClick={() => onToggleApprovalMode?.(nextMode(data.safety.approvalMode))}><SlidersHorizontal size={11} />{data.safety.approvalMode === "AUTONOMOUS" ? "auto" : "gated"}</button>
        <button className="agent-stop-button" type="button" onClick={onEmergencyStop} aria-label="Emergency stop"><Ban size={12} /></button>
      </div>
    </header>
    <section className="agent-connection-strip" aria-label="SSH session metadata"><span className={`agent-ssh-dot agent-ssh-dot--${data.session.sshStatus.toLowerCase()}`} /><strong>{data.session.hostname}</strong><span>{data.session.targetIp}</span><em>{data.session.latencyMs}ms</em><details className="agent-ssh-menu"><summary aria-label="SSH session actions"><ChevronDown size={12} /></summary><div className="agent-ssh-menu-content"><button type="button" onClick={() => onSSHAction?.("RECONNECT")}>Reconnect</button><button type="button" onClick={() => onSSHAction?.("CLEAR_SCROLLBACK")}>Clear scrollback</button><button type="button" onClick={() => onSSHAction?.("SPAWN_SUBSHELL")}>Spawn subshell</button></div></details><small>{sshLabel[data.session.sshStatus]}</small></section>
    <section className="agent-telemetry" aria-label="Engine and context telemetry"><div className="agent-engine"><Cpu size={12} /><span>{data.engine.orchestratorRuntime}</span><em>{data.engine.containerRuntime}</em></div><div className="agent-model"><span>{data.telemetry.activeModel}</span><strong>{(data.telemetry.tokensUsed / 1000).toFixed(1)}k/{(data.telemetry.maxTokens / 1000).toFixed(0)}k</strong></div><div className={`agent-context-track agent-context-track--${tone}`}><i style={{ width: `${usage}%` }} /></div></section>
    <section className="agent-skill-row" aria-label="Available skills">{data.skills.map((skill) => <button key={skill.id} className={`agent-skill agent-skill--${skill.status.toLowerCase()} ${skill.id === data.activeSkillId ? "is-active" : ""}`} type="button" title={skill.policyConstraintMessage} onClick={() => onSkillClick?.(skill.id)}><Radio size={9} /><span>{skill.displayName}</span></button>)}</section>
    <footer className="agent-bar-footer"><span className="agent-sandbox-pill"><Boxes size={10} />{data.sandboxTwin.state} · {data.sandboxTwin.id}</span><span className="agent-policy-pill"><ShieldAlert size={10} />{data.policy.activeRuleSet} · blocked {data.policy.blockedCommandCount}</span><span className={`agent-execution-state ${data.safety.isExecuting ? "is-executing" : ""}`}>{data.safety.isExecuting ? "executing" : "halted"}</span></footer>
  </article>;
}
