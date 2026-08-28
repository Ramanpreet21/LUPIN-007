import type { ReactNode } from "react";
import { Activity, ChevronRight, CircleGauge, Container, Cpu, Database, EthernetPort, Plus, TerminalSquare, Wifi } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { FleetEnvironment, TargetNode } from "@/types/operations";
import { SignalDock } from "./SignalDock";

const environments: Array<{ id: FleetEnvironment; label: string }> = [
  { id: "all", label: "All targets" }, { id: "prod", label: "Production fleet" }, { id: "staging", label: "Staging / QA" }, { id: "ephemeral", label: "Ephemeral twins" }, { id: "edge", label: "Edge nodes" },
];

const runtimeLabel = (runtime: TargetNode["runtimeEngine"]) => runtime.replaceAll("_", " ").replace("DIRECT SSH", "DIRECT SSH").replace("K8S POD", "K8S POD");

export interface FleetViewProps {
  nodes: TargetNode[];
  query: string;
  environment: FleetEnvironment;
  selectedNode: TargetNode | null;
  notice: string;
  onQueryChange: (value: string) => void;
  onEnvironmentChange: (value: FleetEnvironment) => void;
  onSelectNode: (node: TargetNode | null) => void;
  onRegisterTarget: () => void;
  onConnectSubshell: (node: TargetNode) => void;
  onSpawnTwin: (node: TargetNode) => void;
  onHealthCheck: (node: TargetNode) => void;
}

export function FleetView({ nodes, query, environment, selectedNode, notice, onQueryChange, onEnvironmentChange, onSelectNode, onRegisterTarget, onConnectSubshell, onSpawnTwin, onHealthCheck }: FleetViewProps) {
  const total = nodes.length;
  const connected = nodes.filter((node) => node.status === "CONNECTED").length;
  const unreachable = nodes.filter((node) => node.status === "UNREACHABLE").length;
  const twins = nodes.filter((node) => node.environmentTag === "ephemeral").length;
  return <section className="operations-view fleet-view" aria-label="Target Fleet view">
    <header className="ops-topbar">
      <div><p className="eyebrow">Target Fleet</p><h1>Fleet inventory</h1><p>Signal paths remain observable across the registered target surface.</p></div>
      <button className="ops-primary-button" type="button" onClick={onRegisterTarget}><Plus size={16} />Register target node</button>
    </header>
    <div className="ops-metric-grid fleet-metrics">
      <article><span>Total hosts</span><strong>{total}</strong><small>Registered targets</small></article>
      <article className="is-positive"><span>Active connections</span><strong>{connected}</strong><small>SSH control paths</small></article>
      <article className="is-critical"><span>Degraded / unreachable</span><strong>{unreachable + nodes.filter((node) => node.status === "RECONNECTING").length}</strong><small>Needs review</small></article>
      <article className="is-blue"><span>Ephemeral twins</span><strong>{twins}</strong><small>Sandbox scope</small></article>
    </div>
    <section className="ops-panel glass-surface fleet-controls">
      <label className="ops-search"><Wifi size={15} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search hostname, IP, tag, or status" aria-label="Search fleet inventory" /></label>
      <div className="ops-tabs" role="tablist" aria-label="Fleet environments">{environments.map((item) => <button key={item.id} type="button" role="tab" aria-selected={environment === item.id} className={environment === item.id ? "is-active" : ""} onClick={() => onEnvironmentChange(item.id)}>{item.label}</button>)}</div>
    </section>
    <SignalDock eyebrow="Fleet beacon" title="Signal paths remain stable." detail="Three protected nodes are carrying active Lupin work; one edge path is still reacquiring its relay." values={[{ label: "Median RTT", value: "24ms" }, { label: "Agent load", value: "02 / 05" }, { label: "Protected scope", value: "PROD" }]} />
    {notice && <p className="operation-notice"><Activity size={15} />{notice}</p>}
    <section className="ops-panel glass-surface fleet-directory" aria-label="Fleet directory">
      <div className="fleet-table-head"><span>Target</span><span>Connection</span><span>Runtime</span><span>Agent</span><span>Quick actions</span></div>
      <div className="fleet-row-list">{nodes.map((node) => <article className="fleet-row" key={node.id} onClick={() => onSelectNode(node)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onSelectNode(node); }}>
        <div className="fleet-identity"><span className={`node-led node-led--${node.status.toLowerCase()}`} /><div><strong>{node.hostname}</strong><small>{node.ipAddress} · {node.osBadge}</small><em>{node.cloudProvider}</em></div></div>
        <div className="fleet-status"><b className={`ops-status ops-status--${node.status.toLowerCase()}`}>{node.status.replace("_", " ")}</b><small>{node.latencyMs ? `${node.latencyMs}ms SSH RTT` : "No response"}</small></div>
        <span className="ops-tag"><Container size={12} />{runtimeLabel(node.runtimeEngine)}</span>
        <span className={`agent-presence ${node.isAgentExecuting ? "is-executing" : ""}`}><i />{node.isAgentExecuting ? "Task active" : "Standby"}</span>
        <div className="fleet-actions" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => onConnectSubshell(node)}><TerminalSquare size={14} />Subshell</button><button type="button" onClick={() => onSpawnTwin(node)}><Container size={14} />Twin</button><button type="button" onClick={() => onHealthCheck(node)} aria-label={`Ping ${node.hostname}`}><Activity size={14} /></button><ChevronRight size={15} /></div>
      </article>)}</div>
    </section>
    <Dialog open={Boolean(selectedNode)} onOpenChange={(open) => { if (!open) onSelectNode(null); }}>
      <DialogContent className="luma-management-dialog ops-drawer-dialog" showCloseButton={false}>
        {selectedNode && <div className="ops-drawer-shell"><header className="ops-drawer-header"><div><p className="eyebrow">Target node inspection</p><DialogTitle>{selectedNode.hostname}</DialogTitle><DialogDescription>{selectedNode.ipAddress} · {selectedNode.cloudProvider} · {selectedNode.osBadge}</DialogDescription></div><DialogClose className="management-dialog-close" aria-label="Close node inspector">×</DialogClose></header>
          <section className="ops-drawer-body"><div className="drawer-section"><div className="drawer-section-heading"><KeyValueIcon icon={<EthernetPort size={15} />} label="Authentication path" /></div><dl className="ops-key-value"><div><dt>Key path</dt><dd>{selectedNode.authConfig.keyPath}</dd></div><div><dt>User</dt><dd>{selectedNode.authConfig.user}</dd></div><div><dt>Port</dt><dd>{selectedNode.authConfig.port}</dd></div></dl></div>
          <div className="drawer-section"><div className="drawer-section-heading"><KeyValueIcon icon={<CircleGauge size={15} />} label="Resource capacity" /></div><div className="resource-gauges"><Gauge label="CPU" value={`${selectedNode.metrics.cpuPercent}%`} percent={selectedNode.metrics.cpuPercent} /><Gauge label="RAM" value={`${selectedNode.metrics.ramPercent}%`} percent={selectedNode.metrics.ramPercent} /><Gauge label="Disk available" value={`${selectedNode.metrics.diskAvailableGb} GB`} percent={Math.min(100, Math.max(8, 100 - selectedNode.metrics.diskAvailableGb / 2))} /><Gauge label="Processes" value={String(selectedNode.metrics.activeProcesses)} percent={Math.min(100, selectedNode.metrics.activeProcesses / 3)} /></div></div>
          <div className="drawer-section"><div className="drawer-section-heading"><KeyValueIcon icon={<Cpu size={15} />} label="Attached services" /></div><div className="ops-chip-row">{selectedNode.attachedServices.map((service) => <span key={service}>{service}</span>)}</div></div>
          <div className="drawer-section"><div className="drawer-section-heading"><KeyValueIcon icon={<Database size={15} />} label="Recent command ledger" /></div><ol className="execution-timeline">{selectedNode.commandHistory.map((entry) => <li key={entry.id}><time>{entry.time}</time><code>{entry.command}</code><b className={`ops-status ops-status--${entry.outcome.toLowerCase()}`}>{entry.outcome}</b></li>)}</ol></div></section>
        </div>}
      </DialogContent>
    </Dialog>
  </section>;
}

function KeyValueIcon({ icon, label }: { icon: ReactNode; label: string }) { return <h2>{icon}{label}</h2>; }
function Gauge({ label, value, percent }: { label: string; value: string; percent: number }) { return <div className="resource-gauge"><span>{label}<b>{value}</b></span><i><em style={{ width: `${percent}%` }} /></i></div>; }
