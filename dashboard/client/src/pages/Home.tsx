/**
 * LUMA GLASS DESIGN REMINDER
 * The dashboard follows the “Luminous Obsidian Instrument Panel” philosophy:
 * dense, asymmetric instrument layout; dark frosted material; controlled ion-mint signal light;
 * razor-thin specular edges; quiet precision over decorative clutter.
 */
import { type CSSProperties, type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentStatusCapabilitiesBar } from "@/components/AgentStatusCapabilitiesBar";
import { FirstRunSetup, LUMA_SETUP_STORAGE_KEY, readLumaSetup, type FirstRunPreferences } from "@/components/FirstRunSetup";
import { HealthSummaryCard } from "@/components/HealthSummaryCard";
import { LiveTerminal } from "@/components/LiveTerminal";
import { SystemViewLayout } from "@/components/operations/SystemViewLayout";
import { TopologyMapCard } from "@/components/workspace-cards/TopologyMapCard";
import { BlastRadiusCard } from "@/components/workspace-cards/BlastRadiusCard";
import { SandboxTwinCard } from "@/components/workspace-cards/SandboxTwinCard";
import { NotesCard, type OperatorNote } from "@/components/workspace-cards/NotesCard";
import "./archive-fanout.css";
import "@/components/workspace-cards/workspace-cards.css";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { mockAgentStatus } from "@/data/mockAgentStatus";
import { useHealth } from "@/hooks/useHealth";
import { mockBlastRadiusData, mockIncidentContext, mockSandboxTwinData, mockTopologyData, workspaceCardDefinitions } from "@/data/mockWorkspaceCards";
import { IncidentDeck } from "@/components/IncidentDeck";
import { CONTROL_PLANE_ORIGIN, useControlPlane } from "@/hooks/useControlPlane";
import { useControlPlaneTerminalStream } from "@/hooks/useControlPlaneTerminalStream";
import type { AgentStatusSummary, ApprovalMode, SSHStatus } from "@/types/agent-status";
import type { ControlPlaneConnectionStatus } from "@/types/control-plane";
import type { HealthStatus } from "@/types/health";
import { systemViewPaths, type SystemViewId } from "@/types/system-views";
import type { ArchiveWorkspaceCardId } from "@/types/workspace-cards";
import {
  ArrowUpRight,
  Archive,
  CalendarClock,
  Box,
  Cable,
  ChevronsLeft,
  CheckCircle2,
  ChevronDown,
  CloudMoon,
  Copy,
  CornerDownLeft,
  GalleryVerticalEnd,
  Grid2X2,
  KeyRound,
  Layers2,
  MoreHorizontal,
  Eye,
  EyeOff,
  Plus,
  Radio,
  Server,
  Send,
  Search,
  ShieldCheck,
  Settings2,
  Sparkles,
  TerminalSquare,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

type SettingsSection = "general" | "keys" | "mcp" | "skills";
type ConversationMessage = { id: string; role: "assistant" | "user" | "system"; label: string; time: string; content: string };
type BackendPopup = { id: string; source: string; title: string; detail: string; priority: "attention" | "routine" };

const transportToSshStatus: Record<ControlPlaneConnectionStatus, SSHStatus> = {
  CONNECTING: "RECONNECTING",
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
  ERROR: "DISCONNECTED",
};

type WorkspaceClip = {
  path: string;
  notchOutlinePath: string;
  notchStart: number;
  notchWidth: number;
  notchHeight: number;
  width: number;
  height: number;
};

const navItems: { id: SystemViewId; label: string; icon: typeof Grid2X2 }[] = [
  { id: "COMMAND_DECK", label: "Command deck", icon: Grid2X2 },
  { id: "FLEET_INVENTORY", label: "Target fleet", icon: Server },
  { id: "AST_GOVERNANCE", label: "AST safety", icon: ShieldCheck },
  { id: "INCIDENT_ARCHIVE", label: "Incident archive", icon: Archive },
  { id: "SCHEDULED_JOBS", label: "Automation", icon: CalendarClock },
];

const viewIdFromPath = (): SystemViewId => (Object.entries(systemViewPaths).find(([, path]) => path === window.location.pathname)?.[0] as SystemViewId | undefined) ?? "COMMAND_DECK";

const initialConversation: ConversationMessage[] = [
  { id: "conv-01", role: "system", label: "SYSTEM", time: "09:12", content: "Conversation relay synchronized with the current control-plane session." },
  { id: "conv-02", role: "assistant", label: "LUPIN", time: "09:13", content: "I have indexed the active workspace, retained the session context, and am ready for the next operational request." },
  { id: "conv-03", role: "user", label: "OPERATOR", time: "09:14", content: "Summarize the outstanding work and keep me informed when a backend action requires review." },
  { id: "conv-04", role: "assistant", label: "LUPIN", time: "09:14", content: "Three safeguards remain active. I will surface backend-initiated action requests in the notch without interrupting the conversation history." },
  { id: "conv-05", role: "assistant", label: "LUPIN", time: "09:15", content: "The current telemetry stream is healthy. Connection controls and policy-gated operations remain available in their dedicated management surfaces." },
];

function createWorkspaceClip(width: number, height: number): WorkspaceClip {
  const isMobile = window.innerWidth <= 540;
  const isTablet = window.innerWidth <= 840;
  const radius = isTablet ? 20 : 25;
  const notchRadius = isMobile ? 24 : isTablet ? 30 : 38;
  const notchHeight = height * (116 / 353);
  const notchStart = width / 2;
  const notchWidth = width / 2;
  const notchTop = height - notchHeight;

  const path = [
    `M ${radius} 0`,
    `H ${width - radius}`,
    `Q ${width} 0 ${width} ${radius}`,
    `V ${notchTop - notchRadius}`,
    `Q ${width} ${notchTop} ${width - notchRadius} ${notchTop}`,
    `H ${notchStart + notchRadius}`,
    `Q ${notchStart} ${notchTop} ${notchStart} ${notchTop + notchRadius}`,
    `V ${height - notchRadius}`,
    `Q ${notchStart} ${height} ${notchStart - notchRadius} ${height}`,
    `H ${radius}`,
    `Q 0 ${height} 0 ${height - radius}`,
    `V ${radius}`,
    `Q 0 0 ${radius} 0 Z`,
  ].join(" ");

  const notchOutlinePath = [
    `M ${width + 1} ${notchTop - notchRadius - 2}`,
    `V ${notchTop - notchRadius}`,
    `Q ${width} ${notchTop} ${width - notchRadius} ${notchTop}`,
    `H ${notchStart + notchRadius}`,
    `Q ${notchStart} ${notchTop} ${notchStart} ${notchTop + notchRadius}`,
    `V ${height - notchRadius}`,
    `Q ${notchStart} ${height + 1} ${notchStart - notchRadius} ${height + 1}`,
  ].join(" ");

  return { path, notchOutlinePath, notchStart, notchWidth, notchHeight, width, height };
}

export default function Home() {
  const [storedSetup, setStoredSetup] = useState<FirstRunPreferences | null>(() => readLumaSetup());
  const [setupComplete, setSetupComplete] = useState(() => storedSetup !== null);
  const [activeViewId, setActiveViewId] = useState<SystemViewId>(() => viewIdFromPath());
  const [railExpanded, setRailExpanded] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>(initialConversation);
  const [notchMenuOpen, setNotchMenuOpen] = useState(false);
  const [backendPopup, setBackendPopup] = useState<BackendPopup>({ id: "backend-policy-01", source: "Policy relay", title: "Action request ready", detail: "A backend task is awaiting an operator review before it can enter the protected execution queue.", priority: "attention" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sshManagerOpen, setSshManagerOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [mcpConnections, setMcpConnections] = useState([
    { id: "mcp-relay", name: "Relay Control", endpoint: "wss://relay-04.lan/mcp", status: "CONNECTED" },
    { id: "mcp-archive", name: "Archive Index", endpoint: "https://archive.lan/mcp", status: "PAUSED" },
  ]);
  const [sshConnections, setSshConnections] = useState(() => [
    { id: "primary-target", hostname: storedSetup?.ssh.targetHost ?? "relay-04.lan", address: `SSH · ${storedSetup?.ssh.sshPort ?? 22}`, status: storedSetup?.launchMode === "LIVE_HOST" ? "READY" : "CONNECTED", latency: storedSetup?.launchMode === "LIVE_HOST" ? "—" : "1 ms" },
    { id: "staging-02", hostname: "staging-02.lan", address: "SSH · 22", status: "READY", latency: "16 ms" },
  ]);
  const [operatorLabel, setOperatorLabel] = useState(() => storedSetup?.operatorLabel ?? "Operator AG");
  const [mode, setMode] = useState<"Night" | "Focus">(() => storedSetup?.interfaceMode ?? "Night");
  const [launchMode, setLaunchMode] = useState(() => storedSetup?.launchMode ?? "DEMO_MOCK");
  const [commandOpen, setCommandOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() => storedSetup?.defaultApprovalMode ?? mockAgentStatus.safety.approvalMode);
  const [agentStopped, setAgentStopped] = useState(false);
  const [sshStatus, setSshStatus] = useState<SSHStatus>(() => storedSetup?.launchMode === "LIVE_HOST" ? "DISCONNECTED" : mockAgentStatus.session.sshStatus);
  const [activeTarget, setActiveTarget] = useState(() => ({ host: storedSetup?.ssh.targetHost ?? mockAgentStatus.session.hostname, port: storedSetup?.ssh.sshPort ?? 22 }));
  const [activeAgentSkillId, setActiveAgentSkillId] = useState<string | null>(mockAgentStatus.activeSkillId ?? null);
  const controlPlane = useControlPlane();
  const terminalStream = useControlPlaneTerminalStream(controlPlane);
  const health = useHealth();
  const workspaceRef = useRef<HTMLElement>(null);
  const conversationViewportRef = useRef<HTMLDivElement>(null);
  const [workspaceClip, setWorkspaceClip] = useState<WorkspaceClip | null>(null);
  const [archiveFanoutOpen, setArchiveFanoutOpen] = useState(false);
  const [activeWorkspaceCardId, setActiveWorkspaceCardId] = useState<ArchiveWorkspaceCardId>("TOPOLOGY");
  const [selectedTopologyNodeId, setSelectedTopologyNodeId] = useState<string | null>(null);
  const [operatorNotes, setOperatorNotes] = useState<OperatorNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");

  const selectView = (viewId: SystemViewId) => {
    setActiveViewId(viewId);
    window.history.pushState({}, "", systemViewPaths[viewId]);
  };

  useEffect(() => {
    const syncViewFromPath = () => setActiveViewId(viewIdFromPath());
    window.addEventListener("popstate", syncViewFromPath);
    return () => window.removeEventListener("popstate", syncViewFromPath);
  }, []);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const updateClip = () => {
      const bounds = workspace.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        setWorkspaceClip(createWorkspaceClip(bounds.width, bounds.height));
      }
    };

    updateClip();
    const observer = new ResizeObserver(updateClip);
    observer.observe(workspace);
    window.addEventListener("resize", updateClip);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateClip);
    };
  }, []);

  const cutoutCardStyle = workspaceClip
    ? ({ "--cutout-depth": `${workspaceClip.notchHeight}px` } as CSSProperties)
    : undefined;

  const agentStatusData = useMemo<AgentStatusSummary>(
    () => ({
      ...mockAgentStatus,
      session: { ...mockAgentStatus.session, hostname: activeTarget.host, targetIp: `SSH · ${activeTarget.port}`, sshStatus: transportToSshStatus[controlPlane.status], latencyMs: controlPlane.status === "CONNECTED" ? mockAgentStatus.session.latencyMs : 0 },
      engine: { ...mockAgentStatus.engine, socketConnected: controlPlane.status === "CONNECTED" },
      activeSkillId: activeAgentSkillId,
      skills: mockAgentStatus.skills.map((skill) =>
        skill.id === activeAgentSkillId && skill.status !== "RESTRICTED"
          ? { ...skill, status: controlPlane.isExecuting ? "EXECUTING" : "READY" }
          : skill,
      ),
      safety: { ...mockAgentStatus.safety, approvalMode, isExecuting: controlPlane.isExecuting && !agentStopped },
      policy: { ...mockAgentStatus.policy, blockedCommandCount: controlPlane.blockedExecutionCount },
    }),
    [activeAgentSkillId, activeTarget, agentStopped, approvalMode, controlPlane.status, controlPlane.isExecuting, controlPlane.blockedExecutionCount],
  );
  const handleSshAction = (action: "RECONNECT" | "CLEAR_SCROLLBACK" | "SPAWN_SUBSHELL") => { if (action === "RECONNECT") { setSshStatus("RECONNECTING"); window.setTimeout(() => setSshStatus("CONNECTED"), 750); } };
  const addSshConnection = () => setSshConnections((current) => [...current, { id: `node-${current.length + 1}`, hostname: `node-${current.length + 1}.lan`, address: "SSH · 22", status: "DRAFT", latency: "—" }]);
  const toggleMcpConnection = (id: string) => setMcpConnections((current) => current.map((connection) => connection.id === id ? { ...connection, status: connection.status === "CONNECTED" ? "PAUSED" : "CONNECTED" } : connection));
  const submitConversation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    setConversationMessages((current) => [...current, { id: `operator-${Date.now()}`, role: "user", label: "OPERATOR", time: "NOW", content: message }, { id: `lupin-${Date.now()}`, role: "assistant", label: "LUPIN", time: "NOW", content: "Request received. I have added it to the active conversation context and will surface any backend action that needs your review." }]);
    setDraft("");
  };

  useEffect(() => {
    const openBackendPopup = (event: Event) => {
      const detail = (event as CustomEvent<Partial<BackendPopup>>).detail;
      setBackendPopup((current) => ({ ...current, ...detail, id: detail?.id ?? `backend-${Date.now()}`, source: detail?.source ?? "Backend relay", title: detail?.title ?? "Backend action ready", detail: detail?.detail ?? "A backend process requires an operator decision.", priority: detail?.priority ?? "attention" }));
      setNotchMenuOpen(true);
    };
    window.addEventListener("luma:backend-popup", openBackendPopup as EventListener);
    return () => window.removeEventListener("luma:backend-popup", openBackendPopup as EventListener);
  }, []);

  useEffect(() => {
    const viewport = conversationViewportRef.current;
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [conversationMessages]);

  const completeFirstRunSetup = (preferences: FirstRunPreferences) => {
    setStoredSetup(preferences);
    setMode(preferences.interfaceMode);
    setLaunchMode(preferences.launchMode);
    setOperatorLabel(preferences.operatorLabel);
    setApprovalMode(preferences.defaultApprovalMode);
    setActiveTarget({ host: preferences.ssh.targetHost, port: preferences.ssh.sshPort });
    setSshStatus(preferences.launchMode === "LIVE_HOST" ? "DISCONNECTED" : "CONNECTED");
    setSshConnections((current) => [{ id: "primary-target", hostname: preferences.ssh.targetHost, address: `SSH · ${preferences.ssh.sshPort}`, status: preferences.launchMode === "LIVE_HOST" ? "READY" : "CONNECTED", latency: preferences.launchMode === "LIVE_HOST" ? "—" : "1 ms" }, ...current.filter((connection) => connection.id !== "primary-target")]);
    setSetupComplete(true);
  };
  const restartFirstRunSetup = () => {
    try { window.localStorage.removeItem(LUMA_SETUP_STORAGE_KEY); } catch { /* Browser storage can be unavailable. */ }
    setSettingsOpen(false);
    setStoredSetup(null);
    setSetupComplete(false);
  };

  const configureSandbox = async (apiKey: string) => {
    try {
      const response = await fetch(`${CONTROL_PLANE_ORIGIN}/api/settings/sandbox`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const body = (await response.json().catch(() => ({}))) as { status?: string; error?: string; details?: string[] };
      if (!response.ok) {
        return { ok: false, status: body.error, message: body.details?.[0] ?? body.error ?? `HTTP ${response.status}` };
      }
      return { ok: true, status: body.status, message: "Sandbox provider configured." };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  };

  const handleWorkspaceAction = (actionType: string, payload?: Record<string, unknown>) => {
    const detail = Object.entries(payload ?? {}).map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
    setConversationMessages((current) => [...current, { id: `workspace-${Date.now()}`, role: "system", label: "WORKSPACE", time: "NOW", content: `${actionType.replaceAll("_", " ")} staged locally${detail ? ` · ${detail}` : ""}. No external execution has been requested.` }]);
  };

  const addOperatorNote = () => {
    const content = noteDraft.trim();
    if (!content) return;
    const note = { id: `note-${Date.now()}`, content, createdAt: "NOW", isPinned: false };
    setOperatorNotes((current) => [note, ...current]);
    setNoteDraft("");
    handleWorkspaceAction("NOTE_CAPTURED", { noteId: note.id });
  };

  const toggleOperatorNotePin = (noteId: string) => setOperatorNotes((current) => current.map((note) => note.id === noteId ? { ...note, isPinned: !note.isPinned } : note));

  const renderWorkspaceCard = (cardId: ArchiveWorkspaceCardId = activeWorkspaceCardId, preview = false) => {
    const common = { context: mockIncidentContext, onAction: preview ? undefined : handleWorkspaceAction };
    switch (cardId) {
      case "TOPOLOGY": return <TopologyMapCard {...common} className="workspace-card--compact" data={mockTopologyData} selectedNodeId={selectedTopologyNodeId} onSelectNode={setSelectedTopologyNodeId} />;
      case "BLAST_RADIUS": return <BlastRadiusCard {...common} className="workspace-card--compact" data={mockBlastRadiusData} />;
      case "SANDBOX_TWIN": return <SandboxTwinCard {...common} className="workspace-card--compact" data={mockSandboxTwinData} sandboxId={controlPlane.sandbox?.sandbox_id ?? null} />;
      case "NOTES": return <NotesCard className="workspace-card--compact" notes={operatorNotes} draft={noteDraft} onDraftChange={setNoteDraft} onAddNote={addOperatorNote} onTogglePin={toggleOperatorNotePin} />;
      default: return null;
    }
  };

  const availableWorkspaceCards = workspaceCardDefinitions.filter((card) => card.id !== activeWorkspaceCardId);

  if (!setupComplete && activeViewId === "COMMAND_DECK") return <FirstRunSetup onComplete={completeFirstRunSetup} onConfigureSandbox={configureSandbox} />;

  return (
    <main className="luma-canvas fullscreen-canvas">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />
      <div className="ambient ambient-bottom" aria-hidden="true" />

      <section className={`instrument-frame translucent-shell is-fullscreen ${railExpanded ? "is-rail-expanded" : ""}`} aria-label="Lupin control dashboard">
        <aside className={`control-rail glass-surface ${railExpanded ? "is-expanded" : ""}`} aria-label="Primary navigation" onClick={() => { if (!railExpanded) setRailExpanded(true); }}>
          <div className="rail-brand-row">
            <div className="brand-lockup">
              <img className="brand-mark" src="/manus-storage/lupin-mark-transparent_ac979561.png" alt="Lupin" />
              <span className="brand-word">LUPIN</span>
            </div>
            {railExpanded && <button className="rail-collapse" type="button" onClick={() => { setProfileOpen(false); setRailExpanded(false); }} aria-label="Collapse navigation rail"><ChevronsLeft size={17} strokeWidth={1.7} /></button>}
          </div>

          <nav className="rail-navigation" aria-label="Workspace views">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`rail-button ${activeViewId === id ? "is-active" : ""}`}
                onClick={() => selectView(id)}
                aria-pressed={activeViewId === id}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span className="rail-label">{label}</span>
                <span className="rail-tooltip">{label}</span>
              </button>
            ))}
          </nav>

          <div className="rail-lower-actions">
            <div className="rail-profile-stack">
              <button className={`profile-action-trigger ${profileOpen ? "is-open" : ""}`} type="button" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen} aria-haspopup="menu" aria-label="Open profile actions"><span className="profile-orb" aria-hidden="true">{operatorLabel.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "OP"}</span><span className="rail-profile-label">{operatorLabel}</span></button>
              {profileOpen && <div className="profile-action-menu" role="menu" aria-label="Profile actions">
                <button type="button" role="menuitem" onClick={() => { setSettingsOpen(true); setProfileOpen(false); }}><Settings2 size={14} />Settings</button>
                <button type="button" role="menuitem" onClick={() => { setSshManagerOpen(true); setProfileOpen(false); }}><TerminalSquare size={14} />SSH connections</button>
              </div>}
            </div>
          </div>
        </aside>

        <nav className="mobile-view-nav" aria-label="Mobile workspace views">
          {navItems.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={activeViewId === id ? "is-active" : ""} aria-pressed={activeViewId === id} onClick={() => selectView(id)}><Icon size={15} /><span>{label}</span></button>)}
        </nav>

        <section className={`workspace-grid ${activeViewId === "COMMAND_DECK" ? "" : "operations-layout"}`}>
          {activeViewId !== "COMMAND_DECK" ? <SystemViewLayout activeViewId={activeViewId} /> : <>
          <section className="workspace-stage" style={cutoutCardStyle} aria-label="Measured workspace stage">
            <section
              ref={workspaceRef}
              className="focus-module glass-surface"
              aria-label="Unified visual workspace"
              style={workspaceClip ? { clipPath: `path('${workspaceClip.path}')`, WebkitClipPath: `path('${workspaceClip.path}')` } : undefined}
              data-notch-start={workspaceClip?.notchStart.toFixed(5)}
              data-notch-width={workspaceClip?.notchWidth.toFixed(5)}
              data-notch-height={workspaceClip?.notchHeight.toFixed(5)}
            >
              {workspaceClip ? <svg className="workspace-notch-outline" aria-hidden="true" viewBox={`-1 -1 ${workspaceClip.width + 2} ${workspaceClip.height + 2}`} preserveAspectRatio="none"><path d={workspaceClip.notchOutlinePath} /></svg> : null}
              <div className="focus-topbar">
                <div className="status-chip"><span className="live-dot" /> CONVERSATION LIVE</div>
                <button className="icon-control ghost-control" type="button" onClick={() => setNotchMenuOpen(true)} aria-label="Preview backend action popup"><MoreHorizontal size={19} /></button>
              </div>
              <section className="conversation-viewport" ref={conversationViewportRef} aria-label="AI conversation history" tabIndex={0}>
                <div className="conversation-list">
                  {conversationMessages.map((message) => <article className={`conversation-message conversation-message--${message.role}`} key={message.id}><div className="conversation-message-meta"><span>{message.role === "assistant" && <img className="assistant-brand-mark" src="/manus-storage/lupin-mark-transparent_ac979561.png" alt="" />}{message.label}</span><time>{message.time}</time></div><p>{message.content}</p></article>)}
                </div>
              </section>
              {notchMenuOpen ? <section className={`workspace-backend-popup ${backendPopup.priority === "attention" ? "is-attention" : ""}`} aria-label="Backend action popup"><div className="workspace-popup-head"><span className="workspace-popup-indicator"><TriangleAlert size={13} /></span><div><p className="eyebrow">{backendPopup.source}</p><strong>{backendPopup.title}</strong></div></div><p>{backendPopup.detail}</p><div className="workspace-popup-actions"><button type="button" onClick={() => setBackendPopup((current) => ({ ...current, title: "Review queued", detail: "The action request has been routed to the protected review queue.", priority: "routine" }))}>Review</button><button type="button" onClick={() => setConversationMessages((current) => [...current, { id: `backend-${Date.now()}`, role: "system", label: "BACKEND", time: "NOW", content: `Action ${backendPopup.id} was added to the conversation review history.` }])}>History</button><button type="button" onClick={() => setNotchMenuOpen(false)}>Dismiss</button></div></section> : <form className="workspace-input" onSubmit={submitConversation}><button type="submit" aria-label="Send message"><Send size={16} /></button><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask Lupin about the active workspace…" aria-label="Ask Lupin about the active workspace" /><kbd>↵</kbd></form>}
            </section>
            <AgentStatusCapabilitiesBar data={agentStatusData} onToggleApprovalMode={setApprovalMode} onEmergencyStop={() => setAgentStopped(true)} onSSHAction={handleSshAction} onSkillClick={setActiveAgentSkillId} />

          </section>

          <section className="side-modules" aria-label="Workspace insights">
            <IncidentDeck plane={controlPlane} />
            <LiveTerminal stream={terminalStream} />

            <HealthSummaryCard data={health.data} isLoading={health.isLoading} error={health.error} />

            <article className="archive-module glass-surface is-workspace-card">
              <div className="archive-workspace-card">{renderWorkspaceCard()}</div>
              <button type="button" className="archive-action" onClick={() => setArchiveFanoutOpen((open) => !open)} aria-label={archiveFanoutOpen ? "Close lower-right card options" : "Open lower-right card options"} aria-expanded={archiveFanoutOpen}><ArrowUpRight size={17} /></button>
            </article>
            <section className={`archive-fanout archive-fanout--stack ${archiveFanoutOpen ? "is-open" : ""}`} aria-label="Available lower-right card options">{availableWorkspaceCards.map((card) => <article className="archive-fan-card" key={card.id} aria-label={`${card.label} preview`}><div className="archive-fan-card-preview" aria-hidden="true" inert>{renderWorkspaceCard(card.id, true)}</div><button className="archive-fan-card-select" type="button" onClick={() => { setActiveWorkspaceCardId(card.id); setArchiveFanoutOpen(false); }} aria-label={`Show ${card.label}`} /></article>)}</section>
          </section>
          </>}

        </section>
      </section>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="luma-management-dialog" showCloseButton={false}>
          <div className="management-dialog-shell">
            <header className="management-dialog-header">
              <div><p className="eyebrow">Operator configuration</p><DialogTitle>Settings</DialogTitle><DialogDescription>Manage local control-plane preferences, credentials, integrations, and available skills.</DialogDescription></div>
              <DialogClose className="management-dialog-close" aria-label="Close settings"><X size={17} /></DialogClose>
            </header>
            <div className="management-tabbar" role="tablist" aria-label="Settings sections">
              {([ ["general", "General"], ["keys", "API keys"], ["mcp", "MCP connections"], ["skills", "Skills"] ] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={settingsSection === id} className={settingsSection === id ? "is-active" : ""} onClick={() => { setSettingsSection(id); setSettingsNotice(""); }}>{label}</button>)}
            </div>
            <section className="management-dialog-body">
              {settingsSection === "general" && <div className="settings-section-stack"><div className="settings-summary-card"><ShieldCheck size={18} /><div><strong>{launchMode === "LIVE_HOST" ? "Live-host control plane" : "Local demo control plane"}</strong><span>{storedSetup ? `Configured for ${operatorLabel} · ${activeTarget.host}` : "Policy guards are active for remote mutations and outbound network actions."}</span></div><b>{launchMode === "LIVE_HOST" ? "READY" : "DEMO"}</b></div><div className="settings-metric-grid"><div><span>Orchestrator</span><strong>{mockAgentStatus.engine.orchestratorRuntime}</strong></div><div><span>Container runtime</span><strong>{mockAgentStatus.engine.containerRuntime}</strong></div><div><span>Approval mode</span><strong>{approvalMode === "AUTONOMOUS" ? "Autonomous" : "Gated"}</strong></div></div><div className="settings-inline-actions"><button type="button" onClick={() => setSettingsNotice("Diagnostic preferences saved for this session.")}>Save preferences</button><button type="button" onClick={() => setSettingsNotice("Policy review is ready in the control-plane audit queue.")}>Review policy</button><button type="button" onClick={restartFirstRunSetup}>Restart setup</button></div></div>}
              {settingsSection === "keys" && <div className="settings-section-stack"><div className="settings-section-heading"><div><h3>API key management</h3><p>Keys are masked in this frontend prototype and are never rendered in full by default.</p></div><KeyRound size={18} /></div><div className="api-key-row"><div><span>Control-plane relay key</span><strong>{apiKeyVisible ? "lupin_live_81d4_7c6e_••••" : "lupin_••••••••••••••••"}</strong><small>Last rotated 12 days ago · scoped to relay operations</small></div><div className="row-action-group"><button type="button" onClick={() => setApiKeyVisible((value) => !value)} aria-label={apiKeyVisible ? "Mask API key" : "Reveal API key"}>{apiKeyVisible ? <EyeOff size={15} /> : <Eye size={15} />}</button><button type="button" onClick={() => setSettingsNotice("Key identifier copied to the local clipboard queue.")} aria-label="Copy key identifier"><Copy size={15} /></button><button type="button" onClick={() => setSettingsNotice("A replacement relay key has been queued for approval.")}>Rotate</button></div></div><button className="management-add-button" type="button" onClick={() => setSettingsNotice("New API key draft created with least-privilege defaults.")}><KeyRound size={15} />Create scoped key</button></div>}
              {settingsSection === "mcp" && <div className="settings-section-stack"><div className="settings-section-heading"><div><h3>MCP connections</h3><p>Manage connected Model Context Protocol services and their current availability.</p></div><Cable size={18} /></div><div className="connection-list">{mcpConnections.map((connection) => <div className="connection-row" key={connection.id}><div><strong>{connection.name}</strong><span>{connection.endpoint}</span></div><em className={connection.status === "CONNECTED" ? "is-connected" : ""}>{connection.status}</em><button type="button" onClick={() => toggleMcpConnection(connection.id)}>{connection.status === "CONNECTED" ? "Pause" : "Connect"}</button></div>)}</div><button className="management-add-button" type="button" onClick={() => setSettingsNotice("MCP connection draft added; provide its endpoint to continue.")}><Cable size={15} />Add MCP connection</button></div>}
              {settingsSection === "skills" && <div className="settings-section-stack"><div className="settings-section-heading"><div><h3>Skills and execution policies</h3><p>Select the active capability and review its policy scope before execution.</p></div><Sparkles size={18} /></div><div className="skill-management-list">{mockAgentStatus.skills.map((skill) => <div className="skill-management-row" key={skill.id}><div><strong>{skill.displayName}</strong><span>{skill.category.replaceAll("_", " ")} · {skill.executionPolicy === "AUTONOMOUS" ? "Autonomous" : "Policy gated"}</span></div><em>{skill.status}</em><button type="button" className={activeAgentSkillId === skill.id ? "is-selected" : ""} onClick={() => setActiveAgentSkillId(skill.id)}>{activeAgentSkillId === skill.id ? "Active" : "Set active"}</button></div>)}</div></div>}
              {settingsNotice && <p className="management-notice"><CheckCircle2 size={15} />{settingsNotice}</p>}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sshManagerOpen} onOpenChange={setSshManagerOpen}>
        <DialogContent className="luma-management-dialog ssh-management-dialog" showCloseButton={false}>
          <div className="management-dialog-shell">
            <header className="management-dialog-header">
              <div><p className="eyebrow">Remote access registry</p><DialogTitle>SSH connections</DialogTitle><DialogDescription>Add, remove, reconnect, and review the connection state of managed SSH targets.</DialogDescription></div>
              <DialogClose className="management-dialog-close" aria-label="Close SSH connections"><X size={17} /></DialogClose>
            </header>
            <section className="management-dialog-body ssh-manager-body"><div className="ssh-manager-toolbar"><div><span>Managed connections</span><strong>{sshConnections.length} targets</strong></div><button className="management-add-button" type="button" onClick={addSshConnection}><Plus size={15} />Add connection</button></div><div className="ssh-connection-list">{sshConnections.map((connection) => <article className="ssh-connection-card" key={connection.id}><div className="ssh-connection-title"><span className={`ssh-connection-dot ${connection.status === "CONNECTED" ? "is-live" : ""}`} /><div><strong>{connection.hostname}</strong><span>{connection.address}</span></div><em>{connection.status}</em></div><div className="ssh-connection-meta"><span>Latency <b>{connection.id === "relay-04" ? (sshStatus === "RECONNECTING" ? "Reconnecting…" : connection.latency) : connection.latency}</b></span><span>Auth <b>Policy-gated</b></span></div><div className="ssh-connection-actions"><button type="button" onClick={() => handleSshAction("RECONNECT")}>{connection.id === "relay-04" ? "Reconnect" : "Connect"}</button><button type="button" onClick={() => setSshConnections((current) => current.filter((item) => item.id !== connection.id))}><Trash2 size={14} />Remove</button></div></article>)}</div><p className="ssh-manager-footnote">Remote mutations require confirmation under the active production-restricted policy.</p></section>
          </div>
        </DialogContent>
      </Dialog>

      {commandOpen && (
        <section className="command-palette glass-surface" role="dialog" aria-label="Command palette">
          <div className="command-search"><Search size={17} /><input autoFocus placeholder="Search commands" aria-label="Search commands" /><kbd>esc</kbd></div>
          <div className="command-list">
            <button type="button" onClick={() => { setMode("Focus"); setCommandOpen(false); }}><Sparkles size={16} /><span>Enter Focus mode</span><CornerDownLeft size={15} /></button>
            <button type="button" onClick={() => { setMode("Night"); setCommandOpen(false); }}><CloudMoon size={16} /><span>Set Night ambience</span><CornerDownLeft size={15} /></button>
          </div>
          <p className="command-status">Current atmosphere: <strong>{mode}</strong></p>
        </section>
      )}
    </main>
  );
}
