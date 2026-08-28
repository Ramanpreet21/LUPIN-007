import { Orbit, Radio } from "lucide-react";

export function SignalDock({ eyebrow, title, detail, values }: { eyebrow: string; title: string; detail: string; values: Array<{ label: string; value: string }> }) {
  return <section className="signal-dock glass-surface" aria-label={title}>
    <div className="signal-dock-orbit" aria-hidden="true"><i /><i /><b><Orbit size={18} /></b></div>
    <div className="signal-dock-copy"><p className="eyebrow"><Radio size={11} />{eyebrow}</p><strong>{title}</strong><span>{detail}</span></div>
    <div className="signal-dock-readouts">{values.map((item) => <div key={item.label}><span>{item.label}</span><b>{item.value}</b><i><em /></i></div>)}</div>
  </section>;
}
