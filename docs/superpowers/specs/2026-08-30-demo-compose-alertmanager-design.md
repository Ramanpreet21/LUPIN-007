# Design Specification: Automated Demo Mode with Docker Compose & Prometheus AlertManager

**Date:** 2026-08-30  
**Status:** Approved  
**Topic:** Automated Demo Environment, Docker Compose Fleet Orchestration, In-Container Prometheus AlertManager, and LLM Key Guidance UI.

---

## 1. Overview & Objective

When the user selects **Quick Demo Mode** during initial startup or in the settings modal:
1. **Container Cluster Launch**: Automatically spins up the multi-node container fleet and AlertManager service defined in `docker-compose.yml` (`docker compose up -d` with `podman compose` fallback).
2. **Fleet & Sandbox Auto-Configuration**: Automatically registers cluster nodes in SQLite (`tf-server` on `localhost:2222`, user `root`, password `toor`, plus client nodes) and sets the active sandbox provider to the local container runtime (`docker` or `podman`).
3. **AlertManager Integration**: AlertManager container routes firing alerts directly to Lupin's existing webhook receiver (`POST /alerts`) to enter the autonomous diagnosis and remediation loop.
4. **LLM Guidance UI**: Displays a persistent top banner and a pulsing badge on the `AgentStatusCapabilitiesBar` prompting the operator to configure their Gemini / LLM API key in Settings.

---

## 2. Architecture & Components

```
┌────────────────────────────────────────────────────────────┐
│                    Docker Compose Stack                    │
│                                                            │
│  ┌────────────────┐    ┌───────────────┐  ┌─────────────┐  │
│  │   tf-server    │    │ AlertManager  │  │ Prometheus  │  │
│  │  (:2222 root)  │    │    (:9093)    │  │   (:9090)   │  │
│  └────────────────┘    └───────┬───────┘  └─────────────┘  │
│          ▲                     │                           │
│          │ SSH                 │ HTTP POST /alerts         │
└──────────┼─────────────────────┼───────────────────────────┘
           │                     │
           │                     ▼
┌──────────┴─────────────────────────────────────────────────┐
│                    Lupin Control Plane                     │
│                                                            │
│  ┌───────────────────────┐     ┌────────────────────────┐  │
│  │  Compose Orchestrator │     │  Alert Normalizer      │  │
│  │  (/api/demo/start)    │     │  (POST /alerts)        │  │
│  └──────────┬────────────┘     └───────────┬────────────┘  │
│             │                              │               │
│             ▼                              ▼               │
│  ┌───────────────────────┐     ┌────────────────────────┐  │
│  │  Fleet SQLite &       │     │  Remediation Loop      │  │
│  │  Sandbox Twin Config  │     │  (Diagnosis -> AST ->  │  │
│  │  (docker / podman)    │     │   Approval -> SSH Exec)│  │
│  └───────────────────────┘     └────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Specifications

### 3.1 Docker Compose Extension (`docker-compose.yml`)
- Add `alertmanager` service:
  - Image: `prom/alertmanager:latest`
  - Ports: `9093:9093`
  - Networks: `target-net`
  - Config: `alertmanager.yml` configured to send webhook alerts to `http://host.docker.internal:3001/alerts` (with network alias / host gateway configuration for Linux Docker/Podman).
- Add alert dispatch helper in `src/demo/compose-orchestrator.ts` or CLI to fire Prometheus alert payloads directly via AlertManager or `POST /alerts`.

### 3.2 Backend Demo Orchestrator (`src/demo/compose-orchestrator.ts` & `src/routes/demo.ts`)
- **Engine Detection**: Probes `docker` and `podman` binaries and sockets.
- **Compose Commands**:
  - `startDemo()`: Spawns `docker compose up -d` (or `podman compose up -d`).
  - `stopDemo()`: Spawns `docker compose down`.
  - `getDemoStatus()`: Checks container status and port readiness.
  - `sendDemoAlert(alert)`: Dispatches a Prometheus AlertManager JSON payload to `POST /alerts`.
- **Auto-Configuration on `POST /api/demo/start`**:
  - Upserts `tf-server` (`localhost:2222`, `root`, `toor`) into SQLite `fleet_hosts`.
  - Upserts client nodes (`client1`, `client2`, `client3`, `attacker`).
  - Updates `settings` table: `sandbox_provider: "docker"` (or `"podman"`).
  - Broadcasts `fleet_updated` and `sandbox_provider_changed` over WebSocket.

### 3.3 Frontend FirstRunSetup & Banner UI
- **FirstRunSetup (`FirstRunSetup.tsx`)**:
  - Selecting "Quick Demo Mode" triggers `POST /api/demo/start`.
  - Progress feedback indicates container startup, fleet registration, and sandbox calibration.
- **Top Notice Banner (`Home.tsx`)**:
  - Renders when `launchMode === "DEMO_MOCK"` or when LLM API key is unconfigured.
  - Notice text: *"⚡ Demo Environment Active — SSH Cluster & Docker Sandbox configured. Please configure your Gemini / LLM API Key in Settings to enable AI remediation."*
  - Includes button: `[Open Settings]` navigating to Model tab in Settings dialog.
- **Pulsing Agent Status Badge (`AgentStatusCapabilitiesBar.tsx`)**:
  - Animated pulsing amber chip: `[⚠️ API Key Required · Click to Configure]` linking to Settings.
- **Trigger Alert Action**:
  - Quick action in dashboard header or empty state to trigger a demo Prometheus alert.

---

## 4. Error Handling & Edge Cases

1. **Docker / Podman daemon not running**:
   - `POST /api/demo/start` returns structured error `503 container_engine_unavailable` with remediation instructions.
2. **Port 2222 collision**:
   - Checks if port 2222 is in use prior to compose start.
3. **Graceful Teardown**:
   - `POST /api/demo/stop` cleanly executes compose down.
   - On control plane SIGINT/SIGTERM, optionally cleans up or leaves running based on settings.

---

## 5. Verification & Testing

- **Backend Unit Tests**:
  - Test compose orchestrator binary selection and arguments.
  - Test `POST /api/demo/start` fleet upsert and sandbox auto-config.
  - Test Prometheus AlertManager webhook normalization and loop invocation.
- **Frontend Verification**:
  - Verify TypeScript compilation and Vite production build.
  - Verify top banner renders and opens Settings modal.
  - Verify pulsing badge in `AgentStatusCapabilitiesBar`.
