/**
 * LUMA GLASS DESIGN REMINDER
 * The dashboard follows the “Luminous Obsidian Instrument Panel” philosophy:
 * dense, asymmetric instrument layout; dark frosted material; controlled ion-mint signal light;
 * razor-thin specular edges; quiet precision over decorative clutter.
 */
import { type CSSProperties, type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useHealth } from "@/hooks/useHealth";
import { mockBlastRadiusData, mockIncidentContext, mockSandboxTwinData, mockTopologyData, workspaceCardDefinitions } from "@/data/mockWorkspaceCards";
import { IncidentDeck } from "@/components/IncidentDeck";
import { SessionsList } from "@/components/SessionsList";
import { CONTROL_PLANE_ORIGIN, useControlPlane } from "@/hooks/useControlPlane";
import { useControlPlaneTerminalStream } from "@/hooks/useControlPlaneTerminalStream";
import type { AgentStatusSummary, ApprovalMode, SSHStatus } from "@/types/agent-status";
import type { ControlPlaneConnectionStatus } from "@/types/control-plane";
import { systemViewPaths, type SystemViewId } from "@/types/system-views";

const defaultAgentStatus: AgentStatusSummary = {
  session: { targetIp: "192.168.1.104", hostname: "relay-04.lan", sshStatus: "CONNECTED", latencyMs: 8, targetOs: "Ubuntu 24.04" },
  engine: { mode: "LOCAL_MODE", orchestratorRuntime: "TrueForge", containerRuntime: "PODMAN", socketConnected: true },
  skills: [
    { id: "ssh", displayName: "SSH", category: "SSH", status: "READY", executionPolicy: "POLICY_GATED", policyConstraintMessage: "Remote mutations require confirmation." },
    { id: "files", displayName: "Files", category: "Filesystem", status: "READY", executionPolicy: "AUTONOMOUS" },
    { id: "ast", displayName: "AST", category: "AST_Parser", status: "READY", executionPolicy: "AUTONOMOUS" },
    { id: "sandbox", displayName: "Sandbox", category: "Sandbox_Runner", status: "EXECUTING", executionPolicy: "POLICY_GATED", policyConstraintMessage: "Production network access is restricted." },
  ],
  activeSkillId: "sandbox",
  safety: { approvalMode: "AUTONOMOUS", isExecuting: true },
  telemetry: { activeModel: "Claude 3.5 Sonnet", tokensUsed: 14200, maxTokens: 200000 },
  sandboxTwin: { id: "twin-88a2", state: "ACTIVE" },
  policy: { activeRuleSet: "Prod-Restricted", blockedCommandCount: 3 },
};
import type {
  AffectedSubsystem,
  ArchiveWorkspaceCardId,
  BlastRadiusData,
  TopologyEdge,
  TopologyMapData,
  TopologyNode,
} from "@/types/workspace-cards";
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

type SettingsSection = "general" | "sandbox" | "keys" | "mcp" | "skills";
type ConversationMessage = { id: string; role: "assistant" | "user" | "system"; label: string; time: string; content: string };
type BackendPopup = { id: string; source: string; title: string; detail: string; priority: "attention" | "routine" };

export interface SkillConfig {
  id: string;
  name: string;
  description: string;
}

export interface McpConfig {
  id: string;
  name: string;
  description: string;
  url: string;
  authType: "OAuth" | "None" | "API Key";
}

export const PRECONFIGURED_SKILLS: SkillConfig[] = [
  { id: "diagnostic", name: "Root Cause Diagnosis", description: "Analyzes system telemetry, kernel ring buffers, and systemd units to locate incident faults." },
  { id: "remediation", name: "Service Remediation", description: "Automated service recovery, unit restart, and memory-leak isolation runbooks." },
  { id: "log-anomaly", name: "Log Anomaly Detector", description: "Detects spike anomalies, error bursts, and structured syslog crash traces." },
  { id: "network-guard", name: "Network Isolation Guard", description: "Enforces egress rules and validates outbound requests during troubleshooting." },
  { id: "disk-cleanup", name: "Disk Space Remediation", description: "Safely rotates expired journals and prunes unreachable container layer caches." },
  { id: "runbook", name: "Runbook Automation", description: "Executes verified SRE runbook sequences against monitored infrastructure." },
];

export const PRECONFIGURED_MCPS: McpConfig[] = [
  { id: "ssh", name: "SSH Remote Inspector", description: "Model Context Protocol adapter for secure SSH shell and remote execution.", url: "mcp://ssh.internal:8000", authType: "API Key" },
  { id: "cli", name: "Host CLI Runner", description: "Executes sandboxed host inspection commands under policy guardrails.", url: "mcp://cli.internal:8001", authType: "None" },
  { id: "filesystem", name: "Filesystem Audit Tool", description: "Read-only filesystem scanner for config inspection and diffing.", url: "mcp://fs.internal:8002", authType: "None" },
  { id: "k8s", name: "Kubernetes Engine Adapter", description: "Queries pod status, deployment logs, and cluster events.", url: "https://k8s-mcp.internal/v1", authType: "OAuth" },
];

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
  const [settingsData, setSettingsData] = useState<Record<string, string>>({});
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillDesc, setNewSkillDesc] = useState("");
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpDesc, setNewMcpDesc] = useState("");
  const [newMcpUrl, setNewMcpUrl] = useState("");
  const [newMcpAuthType, setNewMcpAuthType] = useState<"None" | "API Key" | "OAuth">("None");

  const DEFAULT_SANDBOX_PROVIDERS = useMemo(() => [
    { id: "daytona", name: "Daytona Cloud (TrueForge Default)", description: "Isolated execution microVMs with snapshot support" },
    { id: "daytona-custom", name: "Daytona Dedicated / Self-Hosted", description: "Private enterprise Daytona server instance" },
    { id: "podman", name: "Local Podman Container", description: "Rootless local Podman container runtime" },
    { id: "docker", name: "Local Docker Container", description: "Host Docker daemon socket" },
    { id: "isolated-local", name: "Simulated Isolated Host Process", description: "Protected local process execution" },
  ], []);

  const [sandboxProvider, setSandboxProvider] = useState<string>("daytona");
  const [sandboxApiKey, setSandboxApiKey] = useState<string>("");
  const [sandboxServerUrl, setSandboxServerUrl] = useState<string>("");
  const [sandboxAutoStopMin, setSandboxAutoStopMin] = useState<number>(30);
  const [sandboxExecTimeoutSec, setSandboxExecTimeoutSec] = useState<number>(300);
  const [sandboxStatus, setSandboxStatus] = useState<string>("ready");
  const [sandboxKeyVisible, setSandboxKeyVisible] = useState<boolean>(false);
  const [sandboxSaving, setSandboxSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!settingsOpen) return;
    void fetch(`${CONTROL_PLANE_ORIGIN}/api/settings`)
      .then((r) => r.json())
      .then((d: Record<string, string>) => {
        setSettingsData(d);
        if (d.sandbox_url) setSandboxServerUrl(d.sandbox_url);
        if (d.sandbox_provider) setSandboxProvider(d.sandbox_provider);
      })
      .catch(() => {});

    void fetch(`${CONTROL_PLANE_ORIGIN}/api/settings/sandbox`)
      .then((r) => r.json())
      .then((d: { configured?: boolean; status?: string }) => {
        if (d?.status) setSandboxStatus(d.status);
      })
      .catch(() => {});
  }, [settingsOpen]);

  const handleSaveSandbox = async () => {
    setSandboxSaving(true);
    setSettingsNotice("");
    try {
      if (sandboxApiKey.trim()) {
        await fetch(`${CONTROL_PLANE_ORIGIN}/api/settings/sandbox`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: sandboxApiKey.trim() }),
        });
      }
      await fetch(`${CONTROL_PLANE_ORIGIN}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandbox_provider: sandboxProvider,
          sandbox_url: sandboxServerUrl,
        }),
      });
      setSandboxStatus("ready");
      setSettingsNotice(`Sandbox provider "${sandboxProvider}" configured successfully.`);
    } catch (err) {
      setSettingsNotice(`Failed to save sandbox: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSandboxSaving(false);
    }
  };

  const skills = useMemo<SkillConfig[]>(() => {
    try {
      const raw = JSON.parse(settingsData.skills ?? "[]");
      if (!Array.isArray(raw) || raw.length === 0) return PRECONFIGURED_SKILLS.slice(0, 3);
      return raw.map((item) => {
        if (typeof item === "string") {
          const pre = PRECONFIGURED_SKILLS.find((p) => p.id === item || p.name.toLowerCase() === item.toLowerCase());
          return pre || { id: item, name: item.charAt(0).toUpperCase() + item.slice(1), description: "Autonomous capability" };
        }
        return item as SkillConfig;
      });
    } catch {
      return PRECONFIGURED_SKILLS.slice(0, 3);
    }
  }, [settingsData.skills]);

  const mcps = useMemo<McpConfig[]>(() => {
    try {
      const raw = JSON.parse(settingsData.mcps ?? "[]");
      if (!Array.isArray(raw) || raw.length === 0) return PRECONFIGURED_MCPS.slice(0, 3);
      return raw.map((item) => {
        if (typeof item === "string") {
          const pre = PRECONFIGURED_MCPS.find((p) => p.id === item || p.name.toLowerCase() === item.toLowerCase());
          return pre || { id: item, name: item.toUpperCase(), description: "Model Context Protocol plugin", url: `mcp://${item}.internal`, authType: "None" };
        }
        return item as McpConfig;
      });
    } catch {
      return PRECONFIGURED_MCPS.slice(0, 3);
    }
  }, [settingsData.mcps]);
  const [sshConnections, setSshConnections] = useState(() => [
    { id: "primary-target", hostname: storedSetup?.ssh.targetHost ?? "relay-04.lan", address: `SSH · ${storedSetup?.ssh.sshPort ?? 22}`, status: storedSetup?.launchMode === "LIVE_HOST" ? "READY" : "CONNECTED", latency: storedSetup?.launchMode === "LIVE_HOST" ? "—" : "1 ms" },
    { id: "staging-02", hostname: "staging-02.lan", address: "SSH · 22", status: "READY", latency: "16 ms" },
  ]);
  const [operatorLabel, setOperatorLabel] = useState(() => storedSetup?.operatorLabel ?? "Operator AG");
  const [mode, setMode] = useState<"Night" | "Focus">(() => storedSetup?.interfaceMode ?? "Night");
  const [launchMode, setLaunchMode] = useState(() => storedSetup?.launchMode ?? "DEMO_MOCK");
  const [commandOpen, setCommandOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() => storedSetup?.defaultApprovalMode ?? defaultAgentStatus.safety.approvalMode);
  const [agentStopped, setAgentStopped] = useState(false);

  const DEFAULT_MODELS = [
    { id: "google-gemini/gemini-3-6-flash", name: "Gemini 3.6 Flash (Google)" },
    { id: "google-gemini/gemini-3-1-pro-preview", name: "Gemini 3.1 Pro Preview (Google)" },
    { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5 (Anthropic)" },
    { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Anthropic)" },
    { id: "anthropic/claude-opus-5", name: "Claude Opus 5 (Anthropic)" },
    { id: "anthropic/claude-opus-4-8", name: "Claude Opus 4.8 (Anthropic)" },
    { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5 (Anthropic)" },
    { id: "anthropic/claude-fable-5", name: "Claude Fable 5 (Anthropic)" },
    { id: "openai/gpt-5-6-terra", name: "GPT-5.6 Terra (OpenAI)" },
    { id: "openai/gpt-5-6-sol", name: "GPT-5.6 Sol (OpenAI)" },
    { id: "openai/gpt-5-6-luna", name: "GPT-5.6 Luna (OpenAI)" },
    { id: "openai/gpt-5-5", name: "GPT-5.5 (OpenAI)" },
    { id: "openai/gpt-5-4-mini", name: "GPT-5.4 Mini (OpenAI)" },
    { id: "fireworks/deepseek-v4-pro", name: "DeepSeek V4 Pro (Fireworks)" },
    { id: "fireworks/kimi-k3", name: "Kimi K3 (Fireworks)" },
    { id: "fireworks/glm-5p2", name: "GLM-5.2 (Fireworks)" },
    { id: "fireworks/minimax-m3", name: "MiniMax M3 (Fireworks)" },
    { id: "alibaba/qwen3-8-max", name: "Qwen 3.8 Max (Alibaba)" },
    { id: "alibaba/qwen3-7-max", name: "Qwen 3.7 Max (Alibaba)" },
    { id: "alibaba/qwen3-7-plus", name: "Qwen 3.7 Plus (Alibaba)" },
    { id: "alibaba/qwen3-7-flash", name: "Qwen 3.7 Flash (Alibaba)" },
    { id: "zai/glm-5-2", name: "GLM 5.2 (Zhipu AI)" },
    { id: "zai/glm-5-turbo", name: "GLM 5 Turbo (Zhipu AI)" },
    { id: "moonshot/kimi-k3", name: "Kimi K3 (Moonshot)" },
    { id: "moonshot/kimi-k2-7-code", name: "Kimi K2.7 Code (Moonshot)" },
    { id: "local", name: "Local Model (Ollama / vLLM)" },
  ];

  const [models, setModels] = useState<Array<{ id: string; name: string }>>(DEFAULT_MODELS);
  const [selectedModel, setSelectedModel] = useState<string>(() => storedSetup?.modelKeys.localLlmEndpoint ?? "google-gemini/gemini-3-6-flash");
  const [sshStatus, setSshStatus] = useState<SSHStatus>(() => storedSetup?.launchMode === "LIVE_HOST" ? "DISCONNECTED" : defaultAgentStatus.session.sshStatus);
  const [activeTarget, setActiveTarget] = useState(() => ({ host: storedSetup?.ssh.targetHost ?? defaultAgentStatus.session.hostname, port: storedSetup?.ssh.sshPort ?? 22 }));
  const [activeAgentSkillId, setActiveAgentSkillId] = useState<string | null>(defaultAgentStatus.activeSkillId ?? null);
  const [fleetHosts, setFleetHosts] = useState<unknown[]>([]);

  const fetchFleetHosts = useCallback(() => {
    void fetch(`${CONTROL_PLANE_ORIGIN}/api/fleet/hosts`)
      .then((r) => r.json())
      .then((d: { data: unknown[] }) => {
        if (Array.isArray(d?.data)) setFleetHosts(d.data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchFleetHosts();
  }, [fetchFleetHosts]);

  useEffect(() => {
    const handleFleetUpdated = () => fetchFleetHosts();
    window.addEventListener("fleet_updated", handleFleetUpdated);
    return () => window.removeEventListener("fleet_updated", handleFleetUpdated);
  }, [fetchFleetHosts]);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const handleConverseThinking = useCallback((content: string, _step: number) => {
    setConversationMessages((current) => {
      const last = current[current.length - 1];
      if (last && last.role === "assistant" && last.id.startsWith("streaming-")) {
        return [
          ...current.slice(0, -1),
          { ...last, content: `${last.content}\n${content}`.trim() },
        ];
      }
      return [
        ...current,
        {
          id: `streaming-${Date.now()}`,
          role: "assistant",
          label: "LUPIN",
          time: "NOW",
          content,
        },
      ];
    });
  }, []);

  const handleConverseComplete = useCallback((content: string, status: "done" | "failed") => {
    setConversationMessages((current) => {
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const last = current[current.length - 1];
      const finalContent = content && content !== "Analyzing request with TrueForge..."
        ? content
        : (status === "done" ? "Request processed successfully." : "Turn completed.");

      if (last && last.role === "assistant" && last.id.startsWith("streaming-")) {
        return [
          ...current.slice(0, -1),
          { ...last, id: `lupin-${Date.now()}`, time, content: finalContent },
        ];
      }
      return [
        ...current,
        {
          id: `lupin-${Date.now()}`,
          role: "assistant",
          label: "LUPIN",
          time,
          content: finalContent,
        },
      ];
    });
  }, []);

  const controlPlane = useControlPlane({
    onFleetUpdated: fetchFleetHosts,
    onConverseThinking: handleConverseThinking,
    onConverseComplete: handleConverseComplete,
  });
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

  useEffect(() => {
    void fetch(`${CONTROL_PLANE_ORIGIN}/api/models`)
      .then((r) => r.json())
      .then((d: { data: Array<{ id: string; name: string }>; active?: string }) => {
        if (Array.isArray(d?.data)) setModels(d.data);
        if (d?.active) setSelectedModel(d.active);
      })
      .catch(() => {});
  }, []);

  const handleToggleApprovalMode = useCallback(async (newMode: ApprovalMode) => {
    setApprovalMode(newMode);
    try {
      await fetch(`${CONTROL_PLANE_ORIGIN}/api/policy/mode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
    } catch (err) {
      console.error("Failed to set approval mode:", err);
      // Revert on error
      setApprovalMode((prev) => prev === "AUTONOMOUS" ? "STRICT_GATED" : "AUTONOMOUS");
    }
  }, []);

  const handleEmergencyStop = useCallback(async () => {
    if (!window.confirm("Emergency stop will cancel ALL active agent sessions. Continue?")) return;
    setAgentStopped(true);
    try {
      await fetch(`${CONTROL_PLANE_ORIGIN}/api/emergency-stop`, { method: "POST" });
    } catch (err) {
      console.error("Emergency stop failed:", err);
    }
  }, []);

  const handleModelChange = useCallback(async (modelId: string) => {
    setSelectedModel(modelId);
    try {
      await fetch(`${CONTROL_PLANE_ORIGIN}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      });
    } catch (err) {
      console.error("Failed to switch model:", err);
    }
  }, []);

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
      ...defaultAgentStatus,
      session: { ...defaultAgentStatus.session, hostname: activeTarget.host, targetIp: `SSH · ${activeTarget.port}`, sshStatus: transportToSshStatus[controlPlane.status], latencyMs: controlPlane.status === "CONNECTED" ? defaultAgentStatus.session.latencyMs : 0 },
      engine: { ...defaultAgentStatus.engine, socketConnected: controlPlane.status === "CONNECTED" },
      activeSkillId: activeAgentSkillId,
      skills: skills.map((skill) => ({
        id: skill.id,
        displayName: skill.name,
        category: "ANALYSIS",
        status: (skill.id === activeAgentSkillId || skill.name.toLowerCase() === activeAgentSkillId?.toLowerCase()) && controlPlane.isExecuting ? "EXECUTING" : "READY",
        executionPolicy: "AUTONOMOUS",
      })),
      safety: { ...defaultAgentStatus.safety, approvalMode, isExecuting: controlPlane.isExecuting && !agentStopped },
      policy: { ...defaultAgentStatus.policy, blockedCommandCount: controlPlane.blockedExecutionCount },
      telemetry: { ...defaultAgentStatus.telemetry, activeModel: selectedModel },
    }),
    [activeAgentSkillId, activeTarget, agentStopped, approvalMode, controlPlane.status, controlPlane.isExecuting, controlPlane.blockedExecutionCount, selectedModel, skills],
  );
  const handleSshAction = (action: "RECONNECT" | "CLEAR_SCROLLBACK" | "SPAWN_SUBSHELL") => { if (action === "RECONNECT") { setSshStatus("RECONNECTING"); window.setTimeout(() => setSshStatus("CONNECTED"), 750); } };
  const addSshConnection = () => setSshConnections((current) => [...current, { id: `node-${current.length + 1}`, hostname: `node-${current.length + 1}.lan`, address: "SSH · 22", status: "DRAFT", latency: "—" }]);

  const handleAddSkill = useCallback(async (skill: SkillConfig) => {
    const trimmedName = skill.name.trim();
    if (!trimmedName || skills.some((s) => s.id === skill.id || s.name.toLowerCase() === trimmedName.toLowerCase())) return;
    const updated = [...skills, { ...skill, name: trimmedName }];
    const raw = JSON.stringify(updated);
    setSettingsData((prev) => ({ ...prev, skills: raw }));
    try {
      await fetch(`${CONTROL_PLANE_ORIGIN}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: raw }),
      });
      setSettingsNotice(`Skill "${trimmedName}" added.`);
    } catch (err) {
      console.error("Failed to add skill:", err);
    }
  }, [skills]);

  const handleRemoveSkill = useCallback(async (id: string) => {
    const updated = skills.filter((s) => s.id !== id && s.name !== id);
    const raw = JSON.stringify(updated);
    setSettingsData((prev) => ({ ...prev, skills: raw }));
    try {
      await fetch(`${CONTROL_PLANE_ORIGIN}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: raw }),
      });
      setSettingsNotice("Skill removed.");
    } catch (err) {
      console.error("Failed to remove skill:", err);
    }
  }, [skills]);

  const handleAddMcp = useCallback(async (mcp: McpConfig) => {
    const trimmedName = mcp.name.trim();
    const trimmedUrl = mcp.url.trim();
    if (!trimmedName || !trimmedUrl || mcps.some((m) => m.id === mcp.id || m.name.toLowerCase() === trimmedName.toLowerCase())) return;
    const updated = [...mcps, { ...mcp, name: trimmedName, url: trimmedUrl }];
    const raw = JSON.stringify(updated);
    setSettingsData((prev) => ({ ...prev, mcps: raw }));
    try {
      await fetch(`${CONTROL_PLANE_ORIGIN}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcps: raw }),
      });
      setSettingsNotice(`MCP connection "${trimmedName}" added.`);
    } catch (err) {
      console.error("Failed to add MCP:", err);
    }
  }, [mcps]);

  const handleRemoveMcp = useCallback(async (id: string) => {
    const updated = mcps.filter((m) => m.id !== id && m.name !== id);
    const raw = JSON.stringify(updated);
    setSettingsData((prev) => ({ ...prev, mcps: raw }));
    try {
      await fetch(`${CONTROL_PLANE_ORIGIN}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcps: raw }),
      });
      setSettingsNotice("MCP connection removed.");
    } catch (err) {
      console.error("Failed to remove MCP:", err);
    }
  }, [mcps]);

  const handleCreateSession = useCallback(async () => {
    try {
      const res = await fetch(`${CONTROL_PLANE_ORIGIN}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel }),
      });
      if (res.ok) {
        const session = (await res.json()) as { id: string; summary?: string };
        setActiveSessionId(session.id);
        setConversationMessages([
          {
            id: `sys-${Date.now()}`,
            role: "system",
            label: "SYSTEM",
            time: "NOW",
            content: `Started new TrueForge interactive session: ${session.id}`,
          },
        ]);
      }
    } catch (err) {
      console.error("Failed to create new session:", err);
    }
  }, [selectedModel]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setConversationMessages([
      {
        id: `sys-${Date.now()}`,
        role: "system",
        label: "SYSTEM",
        time: "NOW",
        content: `Switched context to session: ${sessionId}`,
      },
    ]);
  }, []);

  const submitConversation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setConversationMessages((current) => [
      ...current,
      { id: `operator-${Date.now()}`, role: "user", label: "OPERATOR", time, content: message },
      { id: `streaming-${Date.now()}`, role: "assistant", label: "LUPIN", time, content: "Analyzing request with TrueForge..." },
    ]);
    setDraft("");
    void controlPlane.converse(message, activeSessionId ?? undefined).catch((err) => {
      setConversationMessages((current) => [
        ...current.filter((m) => !m.id.startsWith("streaming-")),
        {
          id: `err-${Date.now()}`,
          role: "system",
          label: "SYSTEM",
          time: "NOW",
          content: `Failed to dispatch to TrueForge: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    });
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
    const pendingIncident = controlPlane.incidents.find((i) => i.pending);
    if (pendingIncident?.pending) {
      const p = pendingIncident.pending;
      setBackendPopup({
        id: pendingIncident.incident_id,
        source: `Incident ${pendingIncident.incident_id}`,
        title: "Action approval required",
        detail: p.proposed_command || (p.proposed_commands?.[0] ?? "A destructive command requires operator approval before execution."),
        priority: "attention",
      });
      setNotchMenuOpen(true);
    }
  }, [controlPlane.incidents]);

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

  const topologyData = useMemo<TopologyMapData>(() => {
    if (!fleetHosts || fleetHosts.length === 0) {
      return mockTopologyData;
    }
    const hosts = fleetHosts as Array<{
      id?: string;
      hostname?: string;
      ip?: string | null;
      port?: number | null;
      podman_socket?: string | null;
      last_probe_status?: string | null;
      probe_latency_ms?: number | null;
      probe_error?: string | null;
    }>;
    const nodes: TopologyNode[] = hosts.map((host, idx) => {
      const hostname = host.hostname ?? `host-${idx + 1}`;
      let type: TopologyNode["type"] = "SYSTEMD";
      if (host.podman_socket) {
        type = "CONTAINER";
      } else if (hostname.toLowerCase().includes("db") || hostname.toLowerCase().includes("postgres")) {
        type = "DATABASE";
      } else if (hostname.toLowerCase().includes("proxy") || hostname.toLowerCase().includes("nginx")) {
        type = "REVERSE_PROXY";
      }

      let status: TopologyNode["status"] = "HEALTHY";
      if (host.last_probe_status === "offline") {
        status = "CRITICAL";
      } else if (host.last_probe_status === "degraded" || host.probe_error) {
        status = "DEGRADED";
      }

      return {
        id: host.id || hostname || `node-${idx}`,
        label: hostname,
        type,
        status,
        pid: 120 + ((idx * 173) % 800),
        memoryMb: 64 + ((idx * 256) % 1024),
        openFds: 40 + ((idx * 37) % 200),
        ports: [host.port ? `0.0.0.0:${host.port}` : "0.0.0.0:22", ...(host.ip ? [host.ip] : [])],
      };
    });

    const edges: TopologyEdge[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const src = nodes[i];
      const tgt = nodes[i + 1];
      const latency = hosts[i]?.probe_latency_ms ?? 18;
      const hasErrors = src.status === "CRITICAL" || tgt.status === "CRITICAL" || src.status === "DEGRADED";
      edges.push({
        id: `edge-${src.id}-${tgt.id}`,
        sourceNodeId: src.id,
        targetNodeId: tgt.id,
        latencyMs: latency,
        hasErrors,
      });
    }

    return { nodes, edges };
  }, [fleetHosts]);

  const blastRadiusData = useMemo<BlastRadiusData>(() => {
    const latestApproval = controlPlane.incidents.find((i) => i.pending);
    if (!latestApproval?.pending) return mockBlastRadiusData; // fallback
    const pending = latestApproval.pending;
    const failedBadges = pending.safety_badges.filter((b) => b.status === "fail");
    const riskScore = failedBadges.length > 0
      ? Math.min(100, failedBadges.length * 25)
      : (pending.diff ? 40 : 20);

    return {
      proposedCommand: pending.proposed_command || (pending.proposed_commands?.[0] ?? ""),
      command: pending.proposed_command,
      diff: pending.diff,
      riskScore,
      affectedResources: pending.safety_badges.map((b, idx) => {
        const isFail = b.status === "fail";
        const nameLower = b.name.toLowerCase();
        const type: AffectedSubsystem["type"] =
          nameLower.includes("fs") || nameLower.includes("file") || nameLower.includes("rm")
            ? "FILE_SYSTEM"
            : nameLower.includes("socket") || nameLower.includes("port") || nameLower.includes("net")
            ? "SOCKET"
            : nameLower.includes("mount") || nameLower.includes("volume")
            ? "VOLUME_MOUNT"
            : "SERVICE";
        const severity: AffectedSubsystem["severity"] = isFail ? "DESTRUCTIVE" : "READ_ONLY";

        return {
          id: `badge-${idx}-${b.name}`,
          pathOrResource: b.name,
          type,
          severity,
          description: isFail
            ? `Policy flag: ${b.name} failed validation`
            : `Policy passed: ${b.name} approved`,
        };
      }),
    };
  }, [controlPlane.incidents]);

  const renderWorkspaceCard = (cardId: ArchiveWorkspaceCardId = activeWorkspaceCardId, preview = false) => {
    const common = { context: mockIncidentContext, onAction: preview ? undefined : handleWorkspaceAction };
    switch (cardId) {
      case "TOPOLOGY": return <TopologyMapCard {...common} className="workspace-card--compact" data={topologyData} selectedNodeId={selectedTopologyNodeId} onSelectNode={setSelectedTopologyNodeId} />;
      case "BLAST_RADIUS": return <BlastRadiusCard {...common} className="workspace-card--compact" data={blastRadiusData} />;
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
              <img src="/brand-logo.png" alt="Incident Command Deck" className="h-8 w-8 object-contain" />
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

          <SessionsList
            selectedSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            className="mt-4 border-t border-white/5 pt-2"
          />

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
              </div>
              <section className="conversation-viewport" ref={conversationViewportRef} aria-label="AI conversation history" tabIndex={0}>
                <div className="conversation-list">
                  {conversationMessages.map((message) => <article className={`conversation-message conversation-message--${message.role}`} key={message.id}><div className="conversation-message-meta"><span>{message.role === "assistant" && <img src="/brand-logo.png" alt="Incident Command Deck" className="h-8 w-8 object-contain" />}{message.label}</span><time>{message.time}</time></div><p>{message.content}</p></article>)}
                </div>
              </section>
              {notchMenuOpen ? <section className={`workspace-backend-popup ${backendPopup.priority === "attention" ? "is-attention" : ""}`} aria-label="Backend action popup"><div className="workspace-popup-head"><span className="workspace-popup-indicator"><TriangleAlert size={13} /></span><div><p className="eyebrow">{backendPopup.source}</p><strong>{backendPopup.title}</strong></div></div><p>{backendPopup.detail}</p><div className="workspace-popup-actions"><button type="button" onClick={() => setBackendPopup((current) => ({ ...current, title: "Review queued", detail: "The action request has been routed to the protected review queue.", priority: "routine" }))}>Review</button><button type="button" onClick={() => setConversationMessages((current) => [...current, { id: `backend-${Date.now()}`, role: "system", label: "BACKEND", time: "NOW", content: `Action ${backendPopup.id} was added to the conversation review history.` }])}>History</button><button type="button" onClick={() => setNotchMenuOpen(false)}>Dismiss</button></div></section> : <form className="workspace-input" onSubmit={submitConversation}><button type="submit" aria-label="Send message"><Send size={16} /></button><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask Lupin about the active workspace…" aria-label="Ask Lupin about the active workspace" /><kbd>↵</kbd></form>}
            </section>
            <AgentStatusCapabilitiesBar
              data={agentStatusData}
              onToggleApprovalMode={handleToggleApprovalMode}
              onEmergencyStop={handleEmergencyStop}
              onSSHAction={handleSshAction}
              onSkillClick={setActiveAgentSkillId}
              models={models}
              onModelChange={handleModelChange}
            />

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
              {([ ["general", "General"], ["sandbox", "Sandbox twin"], ["keys", "API keys"], ["mcp", "MCP connections"], ["skills", "Skills"] ] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={settingsSection === id} className={settingsSection === id ? "is-active" : ""} onClick={() => { setSettingsSection(id); setSettingsNotice(""); }}>{label}</button>)}
            </div>
            <section className="management-dialog-body">
              {settingsSection === "general" && (
                <div className="settings-section-stack">
                  <div className="settings-summary-card">
                    <ShieldCheck size={18} />
                    <div>
                      <strong>{launchMode === "LIVE_HOST" ? "Live-host control plane" : "Local demo control plane"}</strong>
                      <span>{storedSetup ? `Configured for ${operatorLabel} · ${activeTarget.host}` : "Policy guards are active for remote mutations and outbound network actions."}</span>
                    </div>
                    <b>{launchMode === "LIVE_HOST" ? "READY" : "DEMO"}</b>
                  </div>
                  <div className="settings-metric-grid">
                    <div><span>Orchestrator</span><strong>{defaultAgentStatus.engine.orchestratorRuntime}</strong></div>
                    <div><span>Container runtime</span><strong>{defaultAgentStatus.engine.containerRuntime}</strong></div>
                    <div><span>Approval mode</span><strong>{approvalMode === "AUTONOMOUS" ? "Autonomous" : "Gated"}</strong></div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-white/5 border border-white/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-white/70">LLM Reasoning Model</span>
                      <span className="text-[10px] text-emerald-400 font-mono">TrueForge Agent Engine</span>
                    </div>
                    <select
                      value={selectedModel}
                      onChange={(e) => handleModelChange(e.target.value)}
                      className="w-full bg-black/60 border border-white/20 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id} className="bg-neutral-900 text-white">
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-white/40">
                      Incident diagnosis sessions and autonomous sandbox runs will use this model.
                    </p>
                  </div>

                  <div className="settings-inline-actions">
                    <button type="button" onClick={() => setSettingsNotice("Diagnostic preferences saved for this session.")}>Save preferences</button>
                    <button type="button" onClick={() => setSettingsNotice("Policy review is ready in the control-plane audit queue.")}>Review policy</button>
                    <button type="button" onClick={restartFirstRunSetup}>Restart setup</button>
                  </div>
                </div>
              )}

              {settingsSection === "sandbox" && (
                <div className="settings-section-stack">
                  <div className="settings-summary-card">
                    <Box size={18} />
                    <div>
                      <strong>TrueForge Sandbox Execution Twin</strong>
                      <span>Isolated environment for running diagnostic commands and proposed remediations before host execution.</span>
                    </div>
                    <b className={sandboxStatus === "ready" ? "text-emerald-400" : "text-amber-400"}>
                      {sandboxStatus.toUpperCase()}
                    </b>
                  </div>

                  <div className="p-3.5 rounded-lg bg-white/5 border border-white/10 space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wider text-white/70">
                        Sandbox Provider Preset
                      </label>
                      <select
                        value={sandboxProvider}
                        onChange={(e) => setSandboxProvider(e.target.value)}
                        className="w-full bg-black/60 border border-white/20 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                      >
                        {DEFAULT_SANDBOX_PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id} className="bg-neutral-900 text-white">
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {(sandboxProvider === "daytona" || sandboxProvider === "daytona-custom") && (
                      <>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold uppercase tracking-wider text-white/70">
                            Daytona API Key
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type={sandboxKeyVisible ? "text" : "password"}
                              value={sandboxApiKey}
                              onChange={(e) => setSandboxApiKey(e.target.value)}
                              placeholder="daytona_••••••••"
                              className="flex-1 bg-black/60 border border-white/20 rounded-md px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-500"
                            />
                            <button
                              type="button"
                              onClick={() => setSandboxKeyVisible((v) => !v)}
                              className="p-2 rounded bg-white/5 border border-white/10 hover:bg-white/10 text-white/70"
                              aria-label="Toggle key visibility"
                            >
                              {sandboxKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-semibold uppercase tracking-wider text-white/70">
                            Daytona Server Endpoint URL
                          </label>
                          <input
                            type="url"
                            value={sandboxServerUrl}
                            onChange={(e) => setSandboxServerUrl(e.target.value)}
                            placeholder="https://app.daytona.io (or custom on-prem server)"
                            className="w-full bg-black/60 border border-white/20 rounded-md px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      </>
                    )}

                    {(sandboxProvider === "podman" || sandboxProvider === "docker") && (
                      <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-wider text-white/70">
                          Runtime Socket Path
                        </label>
                        <input
                          type="text"
                          value={sandboxServerUrl}
                          onChange={(e) => setSandboxServerUrl(e.target.value)}
                          placeholder={sandboxProvider === "podman" ? "/run/user/1000/podman/podman.sock" : "/var/run/docker.sock"}
                          className="w-full bg-black/60 border border-white/20 rounded-md px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="space-y-1">
                        <label className="text-[11px] text-white/50">Auto-stop Idle (minutes)</label>
                        <input
                          type="number"
                          value={sandboxAutoStopMin}
                          onChange={(e) => setSandboxAutoStopMin(Number(e.target.value) || 0)}
                          className="w-full bg-black/60 border border-white/20 rounded px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-white/50">Command Exec Timeout (s)</label>
                        <input
                          type="number"
                          value={sandboxExecTimeoutSec}
                          onChange={(e) => setSandboxExecTimeoutSec(Number(e.target.value) || 60)}
                          className="w-full bg-black/60 border border-white/20 rounded px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="settings-inline-actions">
                    <button
                      type="button"
                      onClick={() => void handleSaveSandbox()}
                      disabled={sandboxSaving}
                      className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
                    >
                      {sandboxSaving ? "Configuring…" : "Save Sandbox Configuration"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettingsNotice("Sandbox execution twin verified successfully against control plane.")}
                    >
                      Test Twin Connection
                    </button>
                  </div>
                </div>
              )}
              {settingsSection === "keys" && <div className="settings-section-stack"><div className="settings-section-heading"><div><h3>API key management</h3><p>Keys are masked in this frontend prototype and are never rendered in full by default.</p></div><KeyRound size={18} /></div><div className="api-key-row"><div><span>Control-plane relay key</span><strong>{apiKeyVisible ? "lupin_live_81d4_7c6e_••••" : "lupin_••••••••••••••••"}</strong><small>Last rotated 12 days ago · scoped to relay operations</small></div><div className="row-action-group"><button type="button" onClick={() => setApiKeyVisible((value) => !value)} aria-label={apiKeyVisible ? "Mask API key" : "Reveal API key"}>{apiKeyVisible ? <EyeOff size={15} /> : <Eye size={15} />}</button><button type="button" onClick={() => setSettingsNotice("Key identifier copied to the local clipboard queue.")} aria-label="Copy key identifier"><Copy size={15} /></button><button type="button" onClick={() => setSettingsNotice("A replacement relay key has been queued for approval.")}>Rotate</button></div></div><button className="management-add-button" type="button" onClick={() => setSettingsNotice("New API key draft created with least-privilege defaults.")}><KeyRound size={15} />Create scoped key</button></div>}
              {settingsSection === "mcp" && (
                <div className="settings-section-stack">
                  <div className="settings-section-heading">
                    <div>
                      <h3>MCP connections</h3>
                      <p>Manage connected Model Context Protocol services and their authentication parameters.</p>
                    </div>
                    <Cable size={18} />
                  </div>

                  <div className="connection-list">
                    {mcps.map((mcp) => (
                      <div className="connection-row" key={mcp.id || mcp.name}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <strong>{mcp.name}</strong>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 font-mono border border-emerald-500/20">
                              {mcp.authType}
                            </span>
                          </div>
                          <p className="text-xs text-white/50 truncate mt-0.5">{mcp.description}</p>
                          <small className="text-[10px] text-white/30 font-mono block truncate">{mcp.url}</small>
                        </div>
                        <em className="is-connected shrink-0">CONNECTED</em>
                        <button type="button" onClick={() => handleRemoveMcp(mcp.id || mcp.name)} title={`Remove ${mcp.name}`}>
                          <Trash2 size={13} /> Remove
                        </button>
                      </div>
                    ))}
                    {mcps.length === 0 && (
                      <p className="text-xs text-white/50 py-2">No MCP connections configured.</p>
                    )}
                  </div>

                  {PRECONFIGURED_MCPS.filter((p) => !mcps.some((m) => m.id === p.id || m.name.toLowerCase() === p.name.toLowerCase())).length > 0 && (
                    <div className="pt-2 border-t border-white/5">
                      <div className="text-[10px] uppercase font-mono tracking-wider text-white/40 mb-2">Available MCP Integrations</div>
                      <div className="grid grid-cols-2 gap-2">
                        {PRECONFIGURED_MCPS.filter((p) => !mcps.some((m) => m.id === p.id || m.name.toLowerCase() === p.name.toLowerCase())).map((p) => (
                          <div key={p.id} className="p-2 rounded-lg bg-white/[0.02] border border-white/10 flex flex-col justify-between gap-1.5">
                            <div>
                              <div className="flex items-center justify-between">
                                <strong className="text-xs text-white/90 block">{p.name}</strong>
                                <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/40">{p.authType}</span>
                              </div>
                              <p className="text-[11px] text-white/40 line-clamp-2 mt-0.5">{p.description}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAddMcp(p)}
                              className="text-xs text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1 rounded transition-colors self-start flex items-center gap-1 font-mono text-[10px] cursor-pointer"
                            >
                              <Plus size={11} /> Connect
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newMcpName.trim() && newMcpUrl.trim() && newMcpDesc.trim()) {
                        handleAddMcp({
                          id: `custom-${Date.now()}`,
                          name: newMcpName.trim(),
                          description: newMcpDesc.trim(),
                          url: newMcpUrl.trim(),
                          authType: newMcpAuthType,
                        });
                        setNewMcpName("");
                        setNewMcpDesc("");
                        setNewMcpUrl("");
                        setNewMcpAuthType("None");
                      }
                    }}
                    className="flex flex-col gap-2 pt-2 border-t border-white/5"
                  >
                    <div className="text-[10px] uppercase font-mono tracking-wider text-white/40">Add Custom MCP</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Name * (e.g. Postgres DB)"
                        value={newMcpName}
                        onChange={(e) => setNewMcpName(e.target.value)}
                        required
                        className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-500/50"
                      />
                      <input
                        type="text"
                        placeholder="URL * (e.g. mcp://db.internal:8000)"
                        value={newMcpUrl}
                        onChange={(e) => setNewMcpUrl(e.target.value)}
                        required
                        className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        placeholder="Description * (e.g. Database schema & query tool)"
                        value={newMcpDesc}
                        onChange={(e) => setNewMcpDesc(e.target.value)}
                        required
                        className="col-span-2 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-500/50"
                      />
                      <select
                        value={newMcpAuthType}
                        onChange={(e) => setNewMcpAuthType(e.target.value as "None" | "API Key" | "OAuth")}
                        className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                      >
                        <option value="None" className="bg-neutral-900 text-white">None</option>
                        <option value="API Key" className="bg-neutral-900 text-white">API Key</option>
                        <option value="OAuth" className="bg-neutral-900 text-white">OAuth</option>
                      </select>
                    </div>
                    <button className="management-add-button self-end mt-1" type="submit">
                      <Cable size={15} />Add MCP connection
                    </button>
                  </form>
                </div>
              )}
              {settingsSection === "skills" && (
                <div className="settings-section-stack">
                  <div className="settings-section-heading">
                    <div>
                      <h3>Skills and execution policies</h3>
                      <p>Select the active capability and review its policy scope before execution.</p>
                    </div>
                    <Sparkles size={18} />
                  </div>

                  <div className="skill-management-list">
                    {skills.map((skill) => (
                      <div className="skill-management-row" key={skill.id || skill.name}>
                        <div className="flex-1 min-w-0">
                          <strong>{skill.name}</strong>
                          <span className="truncate block text-white/50">{skill.description}</span>
                        </div>
                        <em className="shrink-0">READY</em>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            className={activeAgentSkillId === skill.id || activeAgentSkillId === skill.name ? "is-selected" : ""}
                            onClick={() => setActiveAgentSkillId(skill.id)}
                          >
                            {activeAgentSkillId === skill.id || activeAgentSkillId === skill.name ? "Active" : "Set active"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveSkill(skill.id || skill.name)}
                            title={`Remove ${skill.name}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {skills.length === 0 && (
                      <p className="text-xs text-white/50 py-2">No skills configured.</p>
                    )}
                  </div>

                  {PRECONFIGURED_SKILLS.filter((p) => !skills.some((s) => s.id === p.id || s.name.toLowerCase() === p.name.toLowerCase())).length > 0 && (
                    <div className="pt-2 border-t border-white/5">
                      <div className="text-[10px] uppercase font-mono tracking-wider text-white/40 mb-2">Available SRE Capabilities</div>
                      <div className="grid grid-cols-2 gap-2">
                        {PRECONFIGURED_SKILLS.filter((p) => !skills.some((s) => s.id === p.id || s.name.toLowerCase() === p.name.toLowerCase())).map((p) => (
                          <div key={p.id} className="p-2 rounded-lg bg-white/[0.02] border border-white/10 flex flex-col justify-between gap-1.5">
                            <div>
                              <strong className="text-xs text-white/90 block">{p.name}</strong>
                              <p className="text-[11px] text-white/40 line-clamp-2">{p.description}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAddSkill(p)}
                              className="text-xs text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1 rounded transition-colors self-start flex items-center gap-1 font-mono text-[10px] cursor-pointer"
                            >
                              <Plus size={11} /> Add capability
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newSkillName.trim() && newSkillDesc.trim()) {
                        handleAddSkill({
                          id: `custom-${Date.now()}`,
                          name: newSkillName.trim(),
                          description: newSkillDesc.trim(),
                        });
                        setNewSkillName("");
                        setNewSkillDesc("");
                      }
                    }}
                    className="flex flex-col gap-2 pt-2 border-t border-white/5"
                  >
                    <div className="text-[10px] uppercase font-mono tracking-wider text-white/40">Add Custom Skill</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Skill Name * (e.g. Memory Profiler)"
                        value={newSkillName}
                        onChange={(e) => setNewSkillName(e.target.value)}
                        required
                        className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-500/50"
                      />
                      <input
                        type="text"
                        placeholder="Skill Description * (e.g. Analyzes heap & leaks)"
                        value={newSkillDesc}
                        onChange={(e) => setNewSkillDesc(e.target.value)}
                        required
                        className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>
                    <button className="management-add-button self-end mt-1" type="submit">
                      <Sparkles size={15} />Add Skill
                    </button>
                  </form>
                </div>
              )}
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
