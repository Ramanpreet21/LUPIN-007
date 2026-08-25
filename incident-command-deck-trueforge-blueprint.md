# Incident Command Deck — TrueForge-Native Execution Blueprint

## Executive Summary
By leveraging TrueForge's native capabilities (MCP orchestration, sandbox execution, policy gating, telemetry streaming), the Incident Command Deck project reduces from an 8-PR infrastructure-heavy build to a **6-PR UI + configuration-focused** delivery.

**Net Effect:**
- **80% less custom code** (no Docker socket handlers, AST parsers, custom cron engines, sandbox orchestrators)
- **3–4x faster delivery** (focus shifts to UX and operational policy definition)
- **Higher hackathon scoring** (demonstrates deep platform expertise, not basic integration)
- **Stronger production posture** (inherit TrueForge's battle-tested safety gates, telemetry, and SLA guarantees)

---

## 1. Capability Mapping: What TrueForge Owns vs. What We Build

| **Capability** | **TrueForge Native** | **Our Build** |
|---|---|---|
| **LLM-powered agent reasoning** | ✅ Built-in (Claude Sonnet integration) | — |
| **MCP client/server host** | ✅ Built-in (connects SSH, CLI, file system MCPs) | Configure MCP endpoints |
| **Ephemeral sandbox execution** | ✅ Built-in (Podman/Docker isolation, state snapshots) | Enable sandbox mode, relay results to UI |
| **Command safety policy engine** | ✅ Built-in (execution guards, regex restrictions, allowlists) | Define SRE-specific safety policies |
| **Human-in-the-loop gating** | ✅ Built-in (native approval/rejection callbacks) | Render approval payloads on dashboard |
| **Real-time event streaming** | ✅ Built-in (execution traces, tool call logs, stdout/stderr) | WebSocket relay to React dashboard |
| **Scheduled/recurring tasks** | ✅ Built-in (cron-like scheduling) | Trigger drift detection via TrueForge scheduler |
| **Git PR generation** | ❌ Not built-in | Custom Node.js module (~150 lines) |
| **Dashboard UI/UX** | ❌ Not built-in | 9-panel React/Tailwind interface |
| **CLI entrypoint** | ❌ Not built-in | Node.js `serve` command + TrueForge SDK initialization |

**Key Insight:** We are not reimplementing orchestration; we are **configuring and presenting** orchestration that TrueForge already provides.

---

## 2. Simplified Architecture (TrueForge-Aware)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                  INCIDENT COMMAND DECK (React / Tailwind)                │
│  9 Panels: Status | Logs | Topology | Skills | Workspace | Scheduler    │
│            Custom Tile | Command Console | Approval Gate                │
└───────────────────────────────────────┬──────────────────────────────────┘
                                        │ WebSocket
                                        │ (subscribe to TrueForge events)
┌───────────────────────────────────────┴──────────────────────────────────┐
│              LOCAL CONTROL PLANE (Express + WebSocket Relay)             │
│  - Serves React dashboard                                                │
│  - Receives webhook alerts                                               │
│  - Initializes TrueForge.run() with incident payload                    │
│  - Relays TrueForge trace events → WebSocket → React                    │
│  - Handles approval/rejection callbacks                                  │
└───────────────────────────────────────┬──────────────────────────────────┘
                                        │ SDK API
                                        │ (trueforge.run(), trueforge.poll())
┌───────────────────────────────────────┴──────────────────────────────────┐
│                          TRUEFORGE CORE ENGINE                            │
│  ├─ Claude Sonnet reasoning agent                                        │
│  ├─ MCP router (SSH tools, CLI, filesystem, custom MCPs)                 │
│  ├─ Ephemeral sandbox (Podman/Docker isolation)                          │
│  ├─ Execution policy engine (allowlist/blocklist/regex rules)            │
│  ├─ Human-in-the-loop approval gate                                      │
│  └─ Event streaming (execution traces, logs, tool calls)                 │
└──────────────────────────────────────────────────────────────────────────┘
```

### Data Flow (Incident Workflow)

```
1. Alert Webhook arrives
   ↓
2. Express handler → POST to TrueForge.run({ incident_data, policies, mcp_servers })
   ↓
3. TrueForge spawns agent reasoning loop
   ├─ Claude Sonnet reads alert context
   ├─ Claude selects MCP tools (SSH, filesystem, etc.)
   ├─ Claude drafts remediation commands
   ├─ TrueForge policy engine validates commands against safety rules
   │  (destructive wildcards rejected, unbound subshells blocked, etc.)
   ├─ If policy blocked: emit REJECTED event, return to console
   ├─ If policy passed: emit PENDING_APPROVAL event
   │
4. Control Plane relays PENDING_APPROVAL → React dashboard
   ↓
5. Human reviews diff + safety badges → clicks APPROVE or REJECT
   ├─ If REJECT: callback to TrueForge, execution halted
   ├─ If APPROVE: callback to TrueForge, enter sandbox trial
   │
6. TrueForge sandbox execution
   ├─ Spawn ephemeral container (Podman/Docker)
   ├─ Clone target state (SSH state snapshot, system binaries, config files)
   ├─ Execute approved command in sandbox
   ├─ Capture stdout/stderr + exit code
   ├─ Diff sandbox state vs. baseline
   │
7. Control Plane relays sandbox results → React dashboard
   ↓
8. Human reviews sandbox output, approves prod deployment (or aborts)
   ├─ If ABORT: workflow ends, incident logs archived
   ├─ If APPROVE_PROD: TrueForge executes command via SSH on live target
   │
9. Execution on live target, stream results to dashboard
   ↓
10. Incident closed, state recorded, post-mortem logged
```

---

## 3. Simplified 6-PR Roadmap (vs. Original 8-PR)

### PR #1: `feat/local-control-plane`
**Goal:** Initialize TrueForge SDK, spin up Express server, establish WebSocket relay.

**Deliverables:**
- [ ] `package.json` with TrueForge SDK, Express, WebSocket, React build tools
- [ ] CLI: `npx incident-agent serve --port 3000`
- [ ] TrueForge SDK initialization: read config, set up MCP server list
- [ ] Express `/health` endpoint that returns TrueForge engine status
- [ ] WebSocket server that TrueForge can emit events to
- [ ] Logging infrastructure (pino or similar)

**Scope:** ~300 lines of Node.js code
**Success Criteria:**
- `incident-agent serve` launches and shows "Ready at http://localhost:3000"
- TrueForge SDK initializes successfully and detects available MCP servers
- WebSocket connection test works: `wscat ws://localhost:3000/ws`

---

### PR #2: `feat/incident-command-deck-ui`
**Goal:** Build React dashboard with 9-panel layout, mock data, zero live wiring.

**Deliverables:**
- [ ] Next.js app scaffolded (`create-next-app` or manual)
- [ ] Tailwind CSS configured with custom theme (dark mode default)
- [ ] 9 static React components (no state, hardcoded JSON):
  1. Header/Status Bar
  2. System Logs & Telemetry
  3. Live Network Service Map (static SVG topology)
  4. Active Agent Skills (hardcoded MCP tool list)
  5. Agent Live Workspace (mock agent thinking)
  6. Automation Scheduler (mock cron jobs)
  7. Custom Workspace Tile (mock metrics)
  8. Agent Command Console (input bar only, no handler)
  9. Approval Interceptor (mock diff viewer, mock badges)
- [ ] Global theme switcher (light/dark)
- [ ] Responsive grid layout (desktop-first)

**Scope:** ~800 lines of React/Tailwind
**Success Criteria:**
- `npm run dev` launches Next.js dev server at http://localhost:3000
- All 9 panels visible, properly spaced, responsive to window resize
- Mock data loads correctly (hardcoded JSON in each component)

---

### PR #3: `feat/chaos-proof-responder-policies`
**Goal:** Wire up alert webhooks, define TrueForge MCP config and policies, implement basic workflow.

**Deliverables:**
- [ ] Express POST `/alerts` webhook endpoint (accepts Prometheus AlertManager, PagerDuty, custom JSON)
- [ ] Parse alert payload → extract target host, service, severity
- [ ] Define TrueForge configuration:
  - MCP servers (SSH tool config, filesystem tools, CLI runner)
  - Agent system prompt (incident diagnosis instructions)
  - Safety policies (execution guards, allowed commands, regex restrictions)
- [ ] Invoke `TrueForge.run()` with incident context:
  ```javascript
  const result = await trueforge.run({
    system_prompt: INCIDENT_RESPONDER_PROMPT,
    user_message: `Alert: ${alert.service} on ${alert.host}. ${alert.description}`,
    mcp_servers: MCP_CONFIG,
    policies: SAFETY_POLICIES,
    approval_required: true
  });
  ```
- [ ] Relay TrueForge events (REASONING, PENDING_APPROVAL, SANDBOX_TRIAL, etc.) to WebSocket subscribers
- [ ] WebSocket event types:
  - `{ type: "agent_thinking", content: "..." }`
  - `{ type: "pending_approval", diff: "...", safety_badges: [...] }`
  - `{ type: "sandbox_result", exit_code: 0, stdout: "..." }`
  - `{ type: "execution_complete", status: "success" }`

**Scope:** ~400 lines of Node.js + config
**Success Criteria:**
- Webhook accepts alert; TrueForge.run() invoked
- WebSocket emits agent reasoning events in real-time
- Approval gate fires and waits for human decision
- Dashboard receives and displays events (via console.log for now)

---

### PR #4: `feat/sandbox-and-drift-automation`
**Goal:** Enable TrueForge's native sandbox execution, implement drift detection scheduler, add Git PR generation.

**Deliverables:**
- [ ] Update TrueForge.run() call to enable sandbox mode:
  ```javascript
  await trueforge.run({
    ...config,
    execution_mode: "sandbox_first",
    sandbox_config: {
      engine: "podman" | "docker",
      timeout_seconds: 30,
      resource_limits: { memory: "512Mi", cpu: "1" }
    }
  });
  ```
- [ ] Implement drift detection scheduler (cron-like):
  ```javascript
  scheduleTask("0 */6 * * *", async () => {
    // Every 6 hours: read live state via SSH MCP
    const live_state = await ssh_mcp.exec("cat /etc/config");
    const expected_state = await git_repo.read("manifests/current.yaml");
    
    if (diff(live_state, expected_state)) {
      await generatePullRequest({
        title: "Drift detected in prod",
        body: diff_output,
        base: "main",
        head: "drift/auto-detected"
      });
    }
  });
  ```
- [ ] Git PR generation module:
  - Construct diff payload
  - Create GitHub PR via Octokit SDK
  - Add auto-generated description + remediation suggestions
  - Post webhook to bring PR to dashboard (or expose via `/api/recent-prs`)

**Scope:** ~300 lines of Node.js + config
**Success Criteria:**
- Sandbox execution enabled in TrueForge; results relay to dashboard
- Drift detection scheduler fires on schedule
- PR generated when divergence detected; visible in GitHub UI

---

### PR #5: `test/qodo-audit-and-refactoring`
**Goal:** Qodo-assisted code review, automated test generation, hardening.

**Deliverables:**
- [ ] Qodo scans PRs #1–#4 for:
  - Code quality (variable naming, function complexity)
  - Security issues (SQL injection, unvalidated subprocess calls)
  - Test coverage gaps
- [ ] Qodo generates:
  - Unit tests for TrueForge event relay logic
  - Integration tests for webhook → TrueForge.run() flow
  - Security tests for approval gate (e.g., cannot approve without valid session)
- [ ] Implement Qodo-suggested refactorings:
  - Extract common WebSocket event handler
  - Consolidate MCP config into shared module
  - Add input validation for webhook endpoints
- [ ] Coverage report (aim for >70% on control plane logic)

**Scope:** ~200 lines of tests + refactored code
**Success Criteria:**
- Qodo PR comments are addressed
- Test suite runs green
- Coverage report shows ≥70% coverage on core modules

---

### PR #6: `build/npm-packaging-and-distribution`
**Goal:** Package as `@incident-agent/cli` npm module, add one-liner installer.

**Deliverables:**
- [ ] Build script (tsup or esbuild):
  ```bash
  npm run build
  # Output: dist/incident-agent.js (bundled + minified)
  ```
- [ ] `package.json`:
  ```json
  {
    "name": "@incident-agent/cli",
    "version": "1.0.0",
    "bin": { "incident-agent": "./dist/incident-agent.js" },
    "scripts": {
      "serve": "node dist/incident-agent.js serve",
      "build": "tsup src/index.ts --format esm,cjs --outDir dist"
    }
  }
  ```
- [ ] One-liner installer (shell script):
  ```bash
  curl -fsSL https://get.incident-agent.io/install.sh | bash
  # Installs Node.js (if needed), downloads @incident-agent/cli, runs `incident-agent serve`
  ```
- [ ] GitHub Actions CI/CD:
  - Build on every push to main
  - Run test suite
  - Publish to npm on tag
  - Build and publish Docker image (Dockerfile optional)

**Scope:** ~150 lines of build config + shell script
**Success Criteria:**
- `npm install -g @incident-agent/cli`
- `incident-agent serve` works globally
- GitHub Actions CI passes
- Docker image builds successfully (optional)

---

## 4. Capability Comparison: What Each PR Enables

| **PR** | **What It Unlocks** | **Demo-Ready Proof** |
|---|---|---|
| #1 | TrueForge orchestration, WebSocket relay | `incident-agent serve` → health check passes |
| #2 | Dashboard visualization | 9 panels render with mock data |
| #3 | End-to-end alert → approval gate workflow | Webhook accepted → agent reasoning visible → approval prompt shown |
| #4 | Sandbox trial + drift detection | Sandbox execution simulated → Git PR created on drift detected |
| #5 | Code quality + test coverage | Qodo audit passed, coverage >70% |
| #6 | Distribution + one-liner setup | `npm i -g @incident-agent/cli && incident-agent serve` works |

---

## 5. Technical Deep-Dives (By PR)

### PR #1: TrueForge SDK Initialization & Express Harness

**Key Code Patterns:**

```javascript
// src/trueforge.ts
import { TrueForge } from "@trueforge/sdk";

export const trueforge = new TrueForge({
  api_key: process.env.TRUEFORGE_API_KEY,
  mcp_servers: [
    {
      type: "ssh",
      name: "prod-target",
      config: {
        host: process.env.TARGET_HOST,
        user: process.env.SSH_USER,
        key: process.env.SSH_KEY
      }
    },
    {
      type: "cli_runner",
      name: "bash",
      config: { shell: "/bin/bash" }
    }
  ],
  policies: {
    execution_guards: [
      { rule: "block_wildcard_rm", regex: "^rm\\s+.*\\*" },
      { rule: "block_privilege_escalation", regex: "^sudo\\s+rm|^chmod\\s+777" },
      { rule: "block_eval", regex: "eval|source|\\$\\(.*\\)" }
    ]
  }
});

// src/server.ts
import express from "express";
import { WebSocketServer } from "ws";
import { trueforge } from "./trueforge";

const app = express();
const wss = new WebSocketServer({ noServer: true });

app.use(express.json());

// Health check
app.get("/health", async (req, res) => {
  const status = await trueforge.getStatus();
  res.json({ 
    status: "ok", 
    trueforge_ready: status.initialized,
    timestamp: new Date()
  });
});

// Upgrade HTTP to WebSocket
app.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// Global event emitter for TrueForge events
trueforge.on("event", (event) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  });
});

app.listen(3000, () => console.log("Ready at http://localhost:3000"));
```

**Testing Approach:**
```bash
# Test 1: Server starts
npm run dev
curl http://localhost:3000/health  # Should return 200 + JSON

# Test 2: WebSocket connects
wscat ws://localhost:3000/ws
# Should connect without errors

# Test 3: TrueForge initializes
# Check logs for "TrueForge SDK initialized" message
```

---

### PR #3: Alert Webhook & TrueForge Orchestration

**Key Code Patterns:**

```javascript
// src/alerts.ts
import { trueforge } from "./trueforge";

const INCIDENT_RESPONDER_PROMPT = `
You are an expert Site Reliability Engineer (SRE) responding to production incidents.

## Instructions:
1. Analyze the alert context (service, host, metric, threshold)
2. Use SSH and CLI tools to diagnose the root cause
3. If diagnosis suggests a remediation, draft a safe remediation command
4. Keep commands simple, idempotent, and reversible
5. ALWAYS explain your reasoning before proposing action

## Safety First:
- Never use wildcards in destructive commands (rm, truncate, etc.)
- Always test with \`--dry-run\` if available
- Prefer querying state over modifying it
- Flag any unknown or unfamiliar services

## Available Tools:
- SSH: Execute commands on target hosts
- CLI: Run bash commands
- Filesystem: Read config files

Respond in JSON:
{
  "diagnosis": "...",
  "recommended_action": "... | null",
  "confidence": 0.7,
  "risks": ["..."],
  "reversible": true | false
}
`;

export async function handleAlert(payload: any) {
  const {
    service_name,
    target_host,
    alert_summary,
    severity
  } = payload;

  // Invoke TrueForge with incident context
  const result = await trueforge.run({
    system_prompt: INCIDENT_RESPONDER_PROMPT,
    user_message: `
Alert: ${service_name} on ${target_host}
Severity: ${severity}
Summary: ${alert_summary}

Diagnose the issue and propose a safe remediation (if applicable).
    `,
    mcp_servers: ["prod-target", "bash"],
    policies: {
      approval_required: severity !== "low",
      sandbox_trial_required: severity === "critical",
      timeout_seconds: 60
    }
  });

  return result;
}

// src/webhooks.ts
app.post("/alerts", async (req, res) => {
  const alert = req.body;
  
  try {
    const incident = await handleAlert(alert);
    
    // Broadcast to WebSocket subscribers
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "incident_created",
          incident_id: incident.id,
          diagnosis: incident.diagnosis
        }));
      }
    });
    
    res.json({ status: "accepted", incident_id: incident.id });
  } catch (err) {
    console.error("Alert handler error:", err);
    res.status(500).json({ error: err.message });
  }
});
```

**Testing Approach:**
```bash
# Simulate alert webhook
curl -X POST http://localhost:3000/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "service_name": "postgres",
    "target_host": "prod-db-01",
    "alert_summary": "CPU > 80%",
    "severity": "warning"
  }'

# Should return incident_id; WebSocket should show reasoning events
```

---

### PR #4: Sandbox Execution & Drift Detection

**Key Code Patterns:**

```javascript
// src/sandbox.ts
export async function executeSandboxTrial(command: string, target: string) {
  const result = await trueforge.sandbox({
    command,
    target_host: target,
    snapshot_config: {
      include_dirs: ["/etc", "/opt", "/home"],
      exclude_dirs: ["/proc", "/sys", "/dev"],
      timeout_seconds: 30
    }
  });
  
  return {
    exit_code: result.exit_code,
    stdout: result.stdout,
    stderr: result.stderr,
    state_diff: result.state_diff, // File changes in sandbox
    success: result.exit_code === 0
  };
}

// src/drift.ts
import * as cron from "node-cron";
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export function startDriftDetection() {
  // Every 6 hours, detect state drift
  cron.schedule("0 */6 * * *", async () => {
    try {
      console.log("[Drift] Running state audit...");
      
      // Read live state
      const liveState = await trueforge.mcp("ssh").exec(
        "cat /etc/current-config.yaml"
      );
      
      // Read expected state from Git
      const expectedState = await fetch(
        "https://raw.githubusercontent.com/my-org/infra/main/config.yaml"
      ).then(r => r.text());
      
      if (liveState !== expectedState) {
        console.log("[Drift] Divergence detected! Creating PR...");
        
        // Create GitHub PR with diff
        const pr = await octokit.pulls.create({
          owner: "my-org",
          repo: "infra",
          title: "[Auto-Drift] Reconcile prod state with manifest",
          body: `Automated drift detection found divergence.\n\n\`\`\`diff\n${diff(expectedState, liveState)}\n\`\`\``,
          head: `drift/auto-${Date.now()}`,
          base: "main"
        });
        
        // Notify dashboard
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: "drift_detected",
              pr_number: pr.data.number,
              pr_url: pr.data.html_url
            }));
          }
        });
      }
    } catch (err) {
      console.error("[Drift] Error:", err);
    }
  });
}
```

---

## 6. Frontend Wiring Strategy (React/WebSocket)

All 9 panels subscribe to a global WebSocket event stream. As TrueForge emits events, React state updates in real-time.

**Example: Panel 2 (System Logs & Telemetry) + Panel 5 (Agent Workspace)**

```jsx
// components/SystemLogs.tsx
export default function SystemLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:3000/ws");
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      // Filter for log events
      if (msg.type === "log" || msg.type === "agent_thinking") {
        setLogs(prev => [
          ...prev.slice(-99), // Keep last 100 logs
          {
            timestamp: new Date(),
            source: msg.source,
            level: msg.level,
            message: msg.message
          }
        ]);
      }
    };
    
    return () => ws.close();
  }, []);
  
  return (
    <div className="bg-slate-900 text-slate-100 p-4 rounded font-mono text-sm overflow-auto">
      {logs.map((log, i) => (
        <div key={i} className={`text-${log.level}`}>
          [{log.timestamp.toISOString()}] {log.source}: {log.message}
        </div>
      ))}
    </div>
  );
}

// components/ApprovalInterceptor.tsx
export default function ApprovalInterceptor() {
  const [pending, setPending] = useState<ApprovalRequest | null>(null);
  
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:3000/ws");
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.type === "pending_approval") {
        setPending({
          incident_id: msg.incident_id,
          proposed_command: msg.command,
          diff: msg.diff,
          safety_badges: msg.safety_badges
        });
      }
      
      if (msg.type === "execution_complete") {
        setPending(null); // Clear approval state
      }
    };
    
    return () => ws.close();
  }, []);
  
  const handleApprove = async () => {
    if (!pending) return;
    await fetch("/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: pending.incident_id,
        decision: "approved"
      })
    });
  };
  
  if (!pending) return <div>No pending approvals</div>;
  
  return (
    <div className="bg-red-900 border-2 border-red-500 p-6 rounded">
      <h3 className="text-xl font-bold text-red-100">Approval Required</h3>
      
      <div className="mt-4 bg-slate-950 p-4 rounded font-mono text-sm">
        <pre>{pending.proposed_command}</pre>
      </div>
      
      <div className="mt-2 flex gap-2">
        {pending.safety_badges.map((badge, i) => (
          <span
            key={i}
            className={`px-2 py-1 rounded text-xs font-bold ${
              badge.status === "passed"
                ? "bg-green-900 text-green-100"
                : "bg-yellow-900 text-yellow-100"
            }`}
          >
            {badge.name}
          </span>
        ))}
      </div>
      
      <div className="mt-6 flex gap-4">
        <button
          onClick={handleApprove}
          className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded font-bold"
        >
          Approve & Execute
        </button>
        <button
          onClick={() => setPending(null)}
          className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded font-bold"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
```

---

## 7. Execution Timeline (4–6 Week Estimate)

| **Week** | **PRs** | **Milestone** |
|---|---|---|
| **Week 1** | #1, #2 | Infrastructure + UI shell (local server + 9 panels rendering) |
| **Week 2** | #3 | Alert webhooks + TrueForge orchestration (end-to-end diagnosis flow) |
| **Week 3** | #4 | Sandbox execution + drift detection (sandbox trial + Git PR generation) |
| **Week 4** | #5, #6 | Testing + distribution (Qodo audit, npm packaging, CI/CD) |
| **Week 5–6** | Polish | Hardening, documentation, demo preparation |

---

## 8. Hackathon Scoring Strategy

### Evaluation Criteria (Typical Hackathon Rubric)

| **Criterion** | **Our Strength** | **Scoring Tactic** |
|---|---|---|
| **Sponsor Tools Integration (04)** | Deep TrueForge usage (MCP, sandbox, policies, events) | Highlight 5+ TrueForge features in demo; show diff between "basic LLM wrapper" vs. our "orchestration platform integration" |
| **Technical Execution (01)** | Clean, professional codebase with Qodo audit | Mention "80% less custom code, leveraging TrueForge native capabilities"; show test coverage >70% |
| **Innovation (02)** | Human-in-the-Loop SRE automation (novel problem-solving) | Demo real alert ingestion → diagnosis → approval → sandbox trial → production execution in <2 min |
| **Presentation (05)** | Crisp dashboard + professional demo script | Record 2–3 min video of complete incident workflow (alert → resolution) |
| **Completeness (03)** | All 6 PRs + full 9-panel dashboard + working one-liner installer | Show working GitHub repo, npm package, CI/CD passing |

---

## 9. Success Criteria & Done Definition

### By End of Hackathon:

- [ ] **PR #1 Merged:** `incident-agent serve` launches, TrueForge SDK initializes, WebSocket relay working
- [ ] **PR #2 Merged:** 9-panel React dashboard renders with mock data
- [ ] **PR #3 Merged:** Alert webhook → TrueForge.run() → approval gate fully working (end-to-end)
- [ ] **PR #4 Merged:** Sandbox execution enabled, drift detection runs on schedule, PR generation working
- [ ] **PR #5 Merged:** Qodo audit passed, tests >70% coverage, no critical/high security issues
- [ ] **PR #6 Merged:** `npm install -g @incident-agent/cli` works, CI/CD green across all checks
- [ ] **Live Demo:** Alert ingestion → diagnosis → approval → sandbox trial → production execution (< 3 min)
- [ ] **Documentation:** README with architecture diagram, quick-start guide, example policies
- [ ] **GitHub Actions:** Build + test + deploy pipeline passes on all 6 PRs

---

## 10. Risk Mitigation

### Known Risks & Fallback Plans

| **Risk** | **Mitigation** |
|---|---|
| TrueForge SDK documentation incomplete | Coordinate with TrueForge team early; use SDK examples as reference |
| Approval gate UX unclear (users won't understand diff viewer) | Add inline help text; include pre-recorded demo; design approval panel last, iterate with feedback |
| Sandbox trial takes >30 sec (feels slow) | Implement "show thinking" while sandbox runs; add progress bar; timeout to fallback |
| GitHub Actions CI flaky | Add retry logic; use caching for npm dependencies; test locally first |
| Time crunch: Cut features in this order | (1) Drift detection (2) Scheduler UI (3) Custom workspace tile |

---

## 11. Quick-Start for Execution (Day 1)

1. **Create GitHub org/repo:**
   ```bash
   mkdir incident-agent
   cd incident-agent
   git init
   git remote add origin https://github.com/my-org/incident-agent.git
   ```

2. **Set up branch structure:**
   ```bash
   git checkout -b feat/local-control-plane
   # Start building PR #1
   ```

3. **Init Node.js project:**
   ```bash
   npm init -y
   npm install express ws @trueforge/sdk typescript tsx
   npm install --save-dev @types/node @types/express
   ```

4. **Create file structure:**
   ```
   incident-agent/
   ├── src/
   │   ├── index.ts           # CLI entrypoint
   │   ├── server.ts          # Express + WebSocket
   │   ├── trueforge.ts       # TrueForge SDK init
   │   └── alerts.ts          # Alert handler (PR #3)
   ├── web/                   # React app (PR #2)
   │   ├── pages/
   │   ├── components/
   │   └── public/
   ├── package.json
   ├── tsconfig.json
   └── .github/workflows/     # CI/CD (PR #6)
   ```

5. **First commit (PR #1 skeleton):**
   ```bash
   git add .
   git commit -m "feat(harness): Initialize TrueForge SDK + Express server scaffold"
   git push -u origin feat/local-control-plane
   ```

---

## Summary: What You've Optimized

✅ **Before:** 8 PRs, custom Docker orchestration, AST parsing, cron scheduler, sandbox builder, ~3500+ lines of core logic
✅ **After:** 6 PRs, TrueForge orchestration, config + UI focus, ~800 lines of core logic
✅ **Net Result:** 3.5x faster delivery, 80% less code, higher technical score, production-grade safety

**The key insight:** You're not building an orchestration platform; you're building the **control plane and UX** for one. TrueForge is the engine; you're the dashboard and policy layer. This is how professional tools are built.

---

**Ready to start PR #1? Let me know if you'd like a detailed code scaffold or a specific module implementation guide.** 🚀
