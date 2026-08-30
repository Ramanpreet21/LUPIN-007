/**
 * LUMA GLASS DESIGN REMINDER
 * First-run setup uses the Luminous Obsidian Instrument Panel language:
 * dark frosted layers, ion-mint operational signals, asymmetric rails, and compact precise type.
 */
import { useEffect, useState } from "react";
import {
  BellRing,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Computer,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import "./FirstRunSetup.css";

const API = import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";

export const LUMA_SETUP_STORAGE_KEY = "luma:first-run-setup:v1";

export type LaunchMode = "DEMO_MOCK" | "LIVE_HOST";
export type DefaultApprovalMode = "AUTONOMOUS" | "STRICT_GATED";

export interface SSHConfig {
  targetHost: string;
  sshPort: number;
  userKeyPath: string;
}

export interface ModelKeysConfig {
  apiKey?: string;
  localLlmEndpoint?: string;
  baseUrl?: string;
}

export interface NotificationPreferences {
  enableDesktopAlerts: boolean;
  enableSoundAlerts: boolean;
}

export interface FirstRunPreferences {
  operatorLabel: string;
  interfaceMode: "Night" | "Focus";
  launchMode: LaunchMode;
  defaultApprovalMode: DefaultApprovalMode;
  ssh: SSHConfig;
  modelKeys: ModelKeysConfig;
  notifications: NotificationPreferences;
  sandboxUrl?: string;
  completedAt: string;
}

/** Backward-compatible name for the initial onboarding integration. */
export type LumaSetupPreferences = FirstRunPreferences;

export interface FirstRunSetupProps {
  /** Fired on demo launch or after the live-host form is completed. */
  onComplete: (preferences: FirstRunPreferences) => void;
  /** A future backend can inject a real SSH handshake without changing the component. */
  onTestConnection?: (ssh: SSHConfig) => Promise<{ success: boolean; message: string }>;
  /** Configure the live sandbox provider (PR #4 4a) before the controlled flow needs it. */
  onConfigureSandbox?: (apiKey: string) => Promise<{ ok: boolean; status?: string; message: string }>;
  /** Configure the model key for TrueForge sessions (PR #5 5a) before the controlled flow needs it. */
  onConfigureModel?: (apiKey: string) => Promise<{ ok: boolean; status?: string; message: string }>;
  /** Runtime discovery text supplied by a future local agent bridge. */
  detectedRuntimeStatus?: string;
  className?: string;
}

type FirstRunFormState = Omit<FirstRunPreferences, "completedAt">;
type StoredFirstRunPreferences = Omit<FirstRunPreferences, "modelKeys">;

const steps = [
  { id: "launch", label: "Launch path", icon: Sparkles },
  { id: "target", label: "Live host", icon: Computer },
  { id: "safeguards", label: "Safeguards", icon: LockKeyhole },
] as const;

const defaultFormState: FirstRunFormState = {
  operatorLabel: "Lead-SRE-1",
  interfaceMode: "Night",
  launchMode: "LIVE_HOST",
  defaultApprovalMode: "STRICT_GATED",
  ssh: { targetHost: "192.168.1.104", sshPort: 22, userKeyPath: "~/.ssh/id_rsa" },
  modelKeys: { apiKey: "", localLlmEndpoint: "anthropic/claude-sonnet-5", baseUrl: "http://localhost:11434" },
  notifications: { enableDesktopAlerts: true, enableSoundAlerts: false },
  sandboxUrl: "",
};

const demoFormState: FirstRunFormState = {
  ...defaultFormState,
  operatorLabel: "Operator-1",
  launchMode: "DEMO_MOCK",
  ssh: { targetHost: "localhost", sshPort: 22, userKeyPath: "~/.ssh/id_rsa" },
  modelKeys: { apiKey: "", localLlmEndpoint: "anthropic/claude-sonnet-5", baseUrl: "http://localhost:11434" },
  sandboxUrl: "",
};

function useFirstRunFormState() {
  const [form, setForm] = useState<FirstRunFormState>(defaultFormState);
  const update = <Key extends keyof FirstRunFormState>(key: Key, value: FirstRunFormState[Key]) => setForm((current) => ({ ...current, [key]: value }));
  const updateSsh = <Key extends keyof SSHConfig>(key: Key, value: SSHConfig[Key]) => setForm((current) => ({ ...current, ssh: { ...current.ssh, [key]: value } }));
  const updateModelKey = <Key extends keyof ModelKeysConfig>(key: Key, value: ModelKeysConfig[Key]) => setForm((current) => ({ ...current, modelKeys: { ...current.modelKeys, [key]: value } }));
  const updateNotifications = <Key extends keyof NotificationPreferences>(key: Key, value: NotificationPreferences[Key]) => setForm((current) => ({ ...current, notifications: { ...current.notifications, [key]: value } }));
  return { form, setForm, update, updateSsh, updateModelKey, updateNotifications };
}

function isLegacySetup(value: Record<string, unknown>): boolean {
  return "operatorName" in value && "targetHost" in value && "approvalMode" in value;
}

/** Reads persisted non-secret preferences and transparently migrates the prior setup shape. */
export function readLumaSetup(): FirstRunPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(LUMA_SETUP_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    if (isLegacySetup(parsed)) {
      return {
        ...defaultFormState,
        operatorLabel: String(parsed.operatorName || defaultFormState.operatorLabel),
        interfaceMode: parsed.interfaceMode === "Focus" ? "Focus" : "Night",
        launchMode: "LIVE_HOST",
        defaultApprovalMode: parsed.approvalMode === "AUTONOMOUS" ? "AUTONOMOUS" : "STRICT_GATED",
        ssh: { targetHost: String(parsed.targetHost || defaultFormState.ssh.targetHost), sshPort: Number(parsed.targetPort) || 22, userKeyPath: defaultFormState.ssh.userKeyPath },
        notifications: { enableDesktopAlerts: Boolean(parsed.desktopNotifications), enableSoundAlerts: Boolean(parsed.connectionAlerts) },
        sandboxUrl: typeof parsed.sandboxUrl === "string" ? parsed.sandboxUrl : "",
        completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : new Date().toISOString(),
      };
    }
    if (!parsed.ssh || !parsed.notifications || !parsed.launchMode || !parsed.defaultApprovalMode) return null;
    return {
      operatorLabel: String(parsed.operatorLabel || defaultFormState.operatorLabel),
      interfaceMode: parsed.interfaceMode === "Focus" ? "Focus" : "Night",
      launchMode: parsed.launchMode === "DEMO_MOCK" ? "DEMO_MOCK" : "LIVE_HOST",
      defaultApprovalMode: parsed.defaultApprovalMode === "AUTONOMOUS" ? "AUTONOMOUS" : "STRICT_GATED",
      ssh: {
        targetHost: String((parsed.ssh as SSHConfig).targetHost || defaultFormState.ssh.targetHost),
        sshPort: Number((parsed.ssh as SSHConfig).sshPort) || 22,
        userKeyPath: String((parsed.ssh as SSHConfig).userKeyPath || defaultFormState.ssh.userKeyPath),
      },
      // Credentials are intentionally excluded from browser persistence and begin empty after a refresh.
      modelKeys: { apiKey: "", localLlmEndpoint: defaultFormState.modelKeys.localLlmEndpoint, baseUrl: defaultFormState.modelKeys.baseUrl },
      notifications: {
        enableDesktopAlerts: Boolean((parsed.notifications as NotificationPreferences).enableDesktopAlerts),
        enableSoundAlerts: Boolean((parsed.notifications as NotificationPreferences).enableSoundAlerts),
      },
      sandboxUrl: typeof parsed.sandboxUrl === "string" ? parsed.sandboxUrl : "",
      completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function FirstRunSetup({
  onComplete,
  onTestConnection,
  onConfigureSandbox,
  onConfigureModel,
  detectedRuntimeStatus = "Podman socket: /run/user/1000/podman/podman.sock · READY",
  className = "",
}: FirstRunSetupProps) {
  const [step, setStep] = useState(0);
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [sandboxExpanded, setSandboxExpanded] = useState(false);
  const [sandboxVisible, setSandboxVisible] = useState(false);
  const [sandboxProvider, setSandboxProvider] = useState<string>("isolated-local");
  const [sandboxUrl, setSandboxUrl] = useState<string>("");
  const [sandboxKey, setSandboxKey] = useState("");
  const [sandboxProbes, setSandboxProbes] = useState<Array<{ type: string; available: boolean; latencyMs?: number; details?: string; socketPath?: string }>>([]);
  const [sandboxCheck, setSandboxCheck] = useState<{ state: "idle" | "testing" | "success" | "error"; message: string }>({ state: "idle", message: "" });
  const [modelCheck, setModelCheck] = useState<{ state: "idle" | "testing" | "success" | "error"; message: string }>({ state: "idle", message: "" });
  const [connectionCheck, setConnectionCheck] = useState<{ state: "idle" | "testing" | "success" | "error"; message: string }>({ state: "idle", message: "" });
  const [models, setModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  const { form, setForm, update, updateSsh, updateModelKey, updateNotifications } = useFirstRunFormState();

  const API = import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";

  useEffect(() => {
    fetch(`${API}/api/sandboxes/probes`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.probes)) {
          setSandboxProbes(data.probes);
          if (data.activeProvider) setSandboxProvider(data.activeProvider);
        }
      })
      .catch(() => {});

    fetch(`${API}/api/models`)
      .then((r) => r.json())
      .then((data: { data: Array<{ id: string; name: string; provider: string }> }) => {
        if (Array.isArray(data?.data)) {
          setModels(data.data);
        }
      })
      .catch(() => {});
  }, [API]);

  const finishSetup = async (submitted: FirstRunFormState = form) => {
    const completedPreferences: FirstRunPreferences = { ...submitted, completedAt: new Date().toISOString() };
    const { modelKeys: _modelKeys, ...persistedPreferences } = completedPreferences;
    try {
      window.localStorage.setItem(LUMA_SETUP_STORAGE_KEY, JSON.stringify(persistedPreferences satisfies StoredFirstRunPreferences));
    } catch {
      // Storage availability should not block local dashboard use.
    }

    try {
      await fetch(`${API}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: completedPreferences.modelKeys.localLlmEndpoint ?? "",
          operator_name: completedPreferences.operatorLabel,
          enforcement_mode: completedPreferences.defaultApprovalMode,
          sandbox_url: completedPreferences.sandboxUrl ?? "",
        }),
      });

      // Register the SSH host if live mode
      if (completedPreferences.launchMode === "LIVE_HOST" && completedPreferences.ssh.targetHost) {
        await fetch(`${API}/api/fleet/hosts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hostname: completedPreferences.ssh.targetHost,
            port: completedPreferences.ssh.sshPort,
            ssh_user: completedPreferences.ssh.userKeyPath?.split("@")[0] ?? "",
            ssh_key_path: completedPreferences.ssh.userKeyPath,
          }),
        });
      }
    } catch {
      // Non-fatal if offline
    }

    onComplete(completedPreferences);
  };

  const [demoLaunching, setDemoLaunching] = useState(false);
  const [demoStatusText, setDemoStatusText] = useState("");

  const launchDemo = async () => {
    setDemoLaunching(true);
    setDemoStatusText("Launching Docker Compose cluster & AlertManager…");
    try {
      const res = await fetch(`${API}/api/demo/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to start demo compose stack");
      }
      setDemoStatusText(`Cluster online (${data.engine}) · tf-server (:2222) and sandbox calibrated.`);
      const demoState: FirstRunFormState = {
        ...demoFormState,
        ssh: {
          targetHost: "localhost",
          sshPort: 2222,
          userKeyPath: "",
        },
      };
      setForm(demoState);
      setTimeout(() => {
        finishSetup(demoState);
      }, 600);
    } catch (err) {
      setDemoStatusText(`Notice: ${err instanceof Error ? err.message : String(err)}. Proceeding with simulated demo.`);
      setTimeout(() => {
        setForm(demoFormState);
        finishSetup(demoFormState);
      }, 1200);
    }
  };

  const testConnection = async () => {
    setConnectionCheck({ state: "testing", message: "Probing SSH target…" });
    try {
      if (onTestConnection) {
        const result = await onTestConnection(form.ssh);
        setConnectionCheck({ state: result.success ? "success" : "error", message: result.message });
        return;
      }
      const res = await fetch(`${API}/api/fleet/probe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname: form.ssh.targetHost, port: form.ssh.sshPort }),
      });
      const data = (await res.json()) as { ssh: boolean; latency_ms: number; error?: string };
      if (data.ssh) {
        setConnectionCheck({ state: "success", message: `Connected (${data.latency_ms}ms latency)` });
      } else {
        setConnectionCheck({ state: "error", message: data.error ?? "Connection failed" });
      }
    } catch (err) {
      setConnectionCheck({ state: "error", message: err instanceof Error ? err.message : "Probe failed" });
    }
  };

  const saveSandbox = async () => {
    setSandboxCheck({ state: "testing", message: "Probing and configuring sandbox…" });
    try {
      // 1. Probe specific runner
      const probeRes = await fetch(`${API}/api/sandboxes/probe/${sandboxProvider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          socketPath: sandboxUrl.trim(),
          serverUrl: sandboxUrl.trim(),
          apiKey: sandboxKey.trim(),
        }),
      });
      const probeData = await probeRes.json();
      if (!probeData.available && (sandboxProvider === "podman" || sandboxProvider === "docker" || sandboxProvider === "daytona-custom")) {
        setSandboxCheck({
          state: "error",
          message: probeData.error || probeData.details || "Sandbox runner probe failed.",
        });
        return;
      }

      // 2. Persist
      const res = await fetch(`${API}/api/settings/sandbox`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: sandboxProvider,
          serverUrl: sandboxUrl.trim(),
          apiKey: sandboxKey.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.details?.[0] || err.error || "Failed to configure sandbox");
      }
      setSandboxCheck({
        state: "success",
        message: `${sandboxProvider} sandbox successfully calibrated and active.`,
      });
    } catch (err) {
      setSandboxCheck({
        state: "error",
        message: err instanceof Error ? err.message : "The sandbox test could not be completed.",
      });
    }
  };
  const saveModel = async () => {
    const apiKey = form.modelKeys.apiKey?.trim();
    if (!apiKey) return;
    setModelCheck({ state: "testing", message: "Contacting the model provider…" });
    const result = onConfigureModel
      ? await onConfigureModel(apiKey)
      : await new Promise<{ ok: boolean; message: string }>((resolve) => window.setTimeout(() => resolve({ ok: true, message: "Mock model key accepted for TrueForge sessions. A backend callback can replace this configure step." }), 650));
    setModelCheck({ state: result.ok ? "success" : "error", message: result.message });
  };

  return (
    <main className={`first-run-setup ${className}`.trim()} aria-label="Lupin first-run setup">
      <section className="setup-instrument-frame">
        <aside className="setup-progress-rail">
          <div className="setup-brand"><img src="/brand-logo.png" alt="Incident Command Deck" className="h-10 w-10 object-contain" /><span>LUPIN</span></div>
          <div className="setup-progress-copy"><p className="eyebrow">First-run sequence</p><strong>Calibrate the control plane.</strong><span>Configuration is local to this browser until a secure backend is connected.</span></div>
          <ol className="setup-step-list">
            {steps.map((item, index) => {
              const Icon = item.icon;
              return <li key={item.id} className={index === step ? "is-current" : index < step ? "is-complete" : ""}><span><Icon size={15} />{index < step && <Check size={10} />}</span><div><b>0{index + 1}</b><strong>{item.label}</strong></div></li>;
            })}
          </ol>
          <div className="setup-rail-foot"><ShieldCheck size={15} /><span>Local-first setup<br />No credentials are persisted</span></div>
        </aside>

        <section className="setup-content-panel">
          <header className="setup-content-header"><p className="eyebrow">Lupin / Setup {step + 1} of {steps.length}</p><span>Preferences can be restarted from Settings.</span></header>
          <div className="setup-form-wrap">
            {step === 0 && <section className="setup-step-panel" aria-labelledby="setup-launch-title">
              <div className="setup-step-title"><span><Sparkles size={18} /></span><div><h1 id="setup-launch-title">Choose the first launch path.</h1><p>Open a local demo immediately, or prepare a live host with a callback-ready connection workflow.</p></div></div>
              <div className="setup-launch-options">
                <button type="button" className="setup-launch-card setup-launch-card--demo" onClick={launchDemo} disabled={demoLaunching}>
                  <span className="setup-option-icon"><Play size={16} /></span>
                  <span>
                    <strong>{demoLaunching ? "Initializing Demo Stack…" : "Launch Demo Mode"}</strong>
                    <small>{demoStatusText || "Spins up multi-node Docker Compose cluster, AlertManager, and container sandbox."}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <button type="button" className={`setup-launch-card ${form.launchMode === "LIVE_HOST" ? "is-selected" : ""}`} onClick={() => update("launchMode", "LIVE_HOST")} disabled={demoLaunching}>
                  <span className="setup-option-icon"><ShieldCheck size={16} /></span>
                  <span><strong>Connect Live Host</strong><small>Configure SSH, local runtime, and the policy baseline.</small></span>
                  <Check size={16} />
                </button>
              </div>
            </section>}

            {step === 1 && <section className="setup-step-panel" aria-labelledby="setup-target-title">
              <div className="setup-step-title"><span><Computer size={18} /></span><div><h1 id="setup-target-title">Register the live target.</h1><p>Connection details remain local; a later host bridge can provide the handshake callback.</p></div></div>
              <div className="setup-runtime-pill"><span /><strong>{detectedRuntimeStatus}</strong></div>
              <div className="setup-field-grid setup-target-fields"><label className="setup-field"><span>Target host or IP</span><input value={form.ssh.targetHost} onChange={(event) => updateSsh("targetHost", event.target.value)} placeholder="192.168.1.104" autoComplete="off" /></label><label className="setup-field"><span>SSH port</span><input value={String(form.ssh.sshPort)} onChange={(event) => updateSsh("sshPort", Number(event.target.value.replace(/\D/g, "")) || 22)} inputMode="numeric" placeholder="22" /></label></div>
              <label className="setup-field"><span>User / key path</span><input value={form.ssh.userKeyPath} onChange={(event) => updateSsh("userKeyPath", event.target.value)} placeholder="~/.ssh/id_rsa" autoComplete="off" /></label>
              <div className="setup-test-row"><button type="button" className="setup-test-button" onClick={() => void testConnection()} disabled={connectionCheck.state === "testing"}>{connectionCheck.state === "testing" ? "Testing connection…" : "Test connection"}</button>{connectionCheck.state !== "idle" && <span className={`setup-test-result is-${connectionCheck.state}`} aria-live="polite">{connectionCheck.message}</span>}</div>
              <section className="setup-model-keys" aria-label="Model configuration">
                <button type="button" className="setup-model-keys-trigger" onClick={() => setModelsExpanded((value) => !value)} aria-expanded={modelsExpanded}>
                  <span><KeyRound size={15} /><strong>Model configuration</strong><small>Optional local session configuration</small></span>
                  <ChevronDown size={15} />
                </button>
                {modelsExpanded && (
                  <div className="setup-model-keys-body">
                    <label className="setup-field">
                      <span>API key</span>
                      <span className="setup-secret-field">
                        <input type={apiKeyVisible ? "text" : "password"} value={form.modelKeys.apiKey} onChange={(event) => updateModelKey("apiKey", event.target.value)} autoComplete="off" />
                        <button type="button" onClick={() => setApiKeyVisible((value) => !value)} aria-label={apiKeyVisible ? "Hide API key" : "Show API key"}>{apiKeyVisible ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                      </span>
                    </label>
                    <label className="setup-field">
                      <span>LLM model</span>
                      <select value={form.modelKeys.localLlmEndpoint ?? ""} onChange={(e) => updateModelKey("localLlmEndpoint", e.target.value)} className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white/90">
                        <option value="">Select model…</option>
                        {models.map((m) => (<option key={m.id} value={m.id}>{m.name} ({m.provider})</option>))}
                      </select>
                    </label>
                    {form.modelKeys.localLlmEndpoint === "local" && (
                      <label className="setup-field">
                        <span>Base URL</span>
                        <input value={form.modelKeys.baseUrl ?? ""} onChange={(event) => updateModelKey("baseUrl", event.target.value)} placeholder="http://localhost:11434" autoComplete="off" />
                      </label>
                    )}
                    <p className="setup-security-note"><LockKeyhole size={14} /><span><strong>Security note</strong> The API key remains in this tab's memory only and is excluded from local storage and telemetry.</span></p>
                  </div>
                )}
              </section>
              {modelsExpanded && (
                <div className="setup-test-row">
                  <button type="button" className="setup-test-button" onClick={() => void saveModel()} disabled={modelCheck.state === "testing"}>
                    {modelCheck.state === "testing" ? "Configuring…" : "Save model key"}
                  </button>
                  {modelCheck.state !== "idle" && <span className={`setup-test-result is-${modelCheck.state}`} aria-live="polite">{modelCheck.message}</span>}
                </div>
              )}

              <section className="setup-model-keys" aria-label="Sandbox provider">
                <button type="button" className="setup-model-keys-trigger" onClick={() => setSandboxExpanded((value) => !value)} aria-expanded={sandboxExpanded}>
                  <span><Box size={15} /><strong>Sandbox execution runtime</strong><small>Select container or microVM isolation engine</small></span>
                  <ChevronDown size={15} />
                </button>
                {sandboxExpanded && (
                  <div className="setup-model-keys-body">
                    <label className="setup-field">
                      <span>Sandbox isolation type</span>
                      <select
                        value={sandboxProvider}
                        onChange={(e) => setSandboxProvider(e.target.value)}
                        className="bg-neutral-900 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white"
                      >
                        <option value="isolated-local">Simulated Host Process (Local /tmp scratch · Ready)</option>
                        <option value="podman">
                          Local Podman Container {sandboxProbes.find((p) => p.type === "podman")?.available ? "· [Detected]" : "· [Not detected]"}
                        </option>
                        <option value="docker">
                          Local Docker Container {sandboxProbes.find((p) => p.type === "docker")?.available ? "· [Detected]" : "· [Not detected]"}
                        </option>
                        <option value="daytona-custom">Daytona Dedicated / Self-Hosted (Private URL)</option>
                        <option value="daytona">Daytona Cloud (TrueForge Native)</option>
                      </select>
                    </label>

                    {(sandboxProvider === "podman" || sandboxProvider === "docker") && (
                      <label className="setup-field">
                        <span>UNIX Socket Path (optional override)</span>
                        <input
                          value={sandboxUrl}
                          onChange={(e) => setSandboxUrl(e.target.value)}
                          placeholder={sandboxProvider === "podman" ? "/run/user/1000/podman/podman.sock" : "/var/run/docker.sock"}
                          autoComplete="off"
                        />
                      </label>
                    )}

                    {sandboxProvider === "daytona-custom" && (
                      <label className="setup-field">
                        <span>Dedicated Daytona Server URL</span>
                        <input
                          value={sandboxUrl}
                          onChange={(e) => setSandboxUrl(e.target.value)}
                          placeholder="https://daytona.internal.mycompany.com"
                          autoComplete="off"
                        />
                      </label>
                    )}

                    {(sandboxProvider === "daytona" || sandboxProvider === "daytona-custom") && (
                      <label className="setup-field">
                        <span>Daytona API Key</span>
                        <span className="setup-secret-field">
                          <input
                            type={sandboxVisible ? "text" : "password"}
                            value={sandboxKey}
                            onChange={(event) => setSandboxKey(event.target.value)}
                            autoComplete="off"
                            placeholder="daytona_…"
                          />
                          <button type="button" onClick={() => setSandboxVisible((value) => !value)} aria-label={sandboxVisible ? "Hide Daytona API key" : "Show Daytona API key"}>
                            {sandboxVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </span>
                      </label>
                    )}

                    <div className="setup-test-row">
                      <button type="button" className="setup-test-button" onClick={() => void saveSandbox()} disabled={sandboxCheck.state === "testing"}>
                        {sandboxCheck.state === "testing" ? "Probing runtime…" : "Calibrate sandbox"}
                      </button>
                      {sandboxCheck.state !== "idle" && (
                        <span className={`setup-test-result is-${sandboxCheck.state}`} aria-live="polite">
                          {sandboxCheck.message}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </section>}

            {step === 2 && <section className="setup-step-panel" aria-labelledby="setup-safeguards-title">
              <div className="setup-step-title"><span><ShieldCheck size={18} /></span><div><h1 id="setup-safeguards-title">Choose operating boundaries.</h1><p>Set the operator identity, approval default, and the signals Lupin may surface locally.</p></div></div>
              <label className="setup-field"><span>Operator label</span><input value={form.operatorLabel} onChange={(event) => update("operatorLabel", event.target.value)} autoComplete="name" /></label>
              <fieldset className="setup-approval-field"><legend>Default approval policy</legend><div><button type="button" className={form.defaultApprovalMode === "STRICT_GATED" ? "is-selected" : ""} onClick={() => update("defaultApprovalMode", "STRICT_GATED")}><LockKeyhole size={16} /><span><strong>Gated</strong><small>Confirm protected and remote actions</small></span></button><button type="button" className={form.defaultApprovalMode === "AUTONOMOUS" ? "is-selected" : ""} onClick={() => update("defaultApprovalMode", "AUTONOMOUS")}><Check size={16} /><span><strong>Autonomous</strong><small>Proceed when policy allows</small></span></button></div></fieldset>
              <div className="setup-notification-list"><label><input type="checkbox" checked={form.notifications.enableDesktopAlerts} onChange={(event) => updateNotifications("enableDesktopAlerts", event.target.checked)} /><span><BellRing size={16} /><span><strong>Desktop alerts</strong><small>Surface approved local events while Lupin is open.</small></span></span></label><label><input type="checkbox" checked={form.notifications.enableSoundAlerts} onChange={(event) => updateNotifications("enableSoundAlerts", event.target.checked)} /><span><Computer size={16} /><span><strong>Sound alerts</strong><small>Play an audible signal for local connection changes.</small></span></span></label></div>
            </section>}
          </div>
          <footer className="setup-footer"><span><b>{step + 1}</b> / {steps.length}</span><div>{step > 0 && <button type="button" className="setup-back-button" onClick={() => setStep((current) => current - 1)}>Back</button>}{step < steps.length - 1 ? <button type="button" className="setup-next-button" onClick={() => setStep((current) => current + 1)}>Continue <ChevronRight size={16} /></button> : <button type="button" className="setup-next-button" onClick={() => finishSetup()}>Enter Lupin <ChevronRight size={16} /></button>}</div></footer>
        </section>
      </section>
    </main>
  );
}
