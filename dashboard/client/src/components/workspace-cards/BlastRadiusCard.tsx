import type { CSSProperties } from "react";
import { Radar, ShieldCheck, TriangleAlert } from "lucide-react";
import type { AffectedSubsystem, BlastRadiusData, WorkspaceViewProps } from "@/types/workspace-cards";

const SEVERITY_LABEL: Record<AffectedSubsystem["severity"], string> = { READ_ONLY: "READ-ONLY", RESTART_IMPACT: "RESTART", DESTRUCTIVE: "DESTRUCTIVE" };
const SEVERITY_CLASS: Record<AffectedSubsystem["severity"], string> = { READ_ONLY: "", RESTART_IMPACT: "blast-resource--restart_impact", DESTRUCTIVE: "blast-resource--destructive" };

export function BlastRadiusCard({ context, data, onAction, className = "" }: WorkspaceViewProps<BlastRadiusData>) {
  const { proposedCommand, riskScore, affectedResources } = data;
  const hasDestructive = affectedResources.some((resource) => resource.severity === "DESTRUCTIVE");
  const riskLabel = riskScore >= 70 ? "CRITICAL" : riskScore >= 40 ? "ELEVATED" : "LOW";
  const riskDialClass = `${riskScore >= 70 ? "risk-dial-ring--high" : riskScore < 40 ? "risk-dial-ring--low" : ""}`.trim();
  return <section className={`workspace-card blast-card ${className}`.trim()} aria-label="AST blast radius"><header className="workspace-card-head"><div><p className="eyebrow">{context.targetHostname} · command impact surface</p><h2>AST blast-radius</h2><span>Proposed command impact surface.</span></div><span className="workspace-card-state">{hasDestructive ? <TriangleAlert size={13} /> : <ShieldCheck size={13} />}{(hasDestructive ? "APPROVAL HELD" : riskLabel)}</span></header><div className="blast-card-layout"><section className="blast-tree"><div className="blast-command"><Radar size={13} /><code>{proposedCommand}</code></div><div className="blast-branches">{affectedResources.map((resource) => <div key={resource.id} className={`blast-resource ${SEVERITY_CLASS[resource.severity]}`.trim()}><span /><div><p>{resource.type.replace("_", " ")}</p><strong>{resource.pathOrResource}</strong><small>{resource.description}</small></div><b>{SEVERITY_LABEL[resource.severity]}</b></div>)}</div></section><section className="risk-dial"><div className={`risk-dial-ring ${riskDialClass}`.trim()} style={{ "--risk": `${riskScore}%` } as CSSProperties}><strong>{riskScore}</strong><span>risk score</span></div><p>{hasDestructive ? <TriangleAlert size={12} /> : <ShieldCheck size={12} />}{hasDestructive ? "Protected data mount in scope" : "No destructive write path"}</p><button type="button" onClick={() => onAction?.("RUN_BLAST_SCAN", { proposedCommand })}>Verify scope</button></section></div></section>;
}