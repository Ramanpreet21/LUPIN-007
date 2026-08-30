# Multi-Runtime Sandbox Architecture Specification

- **Date**: 2026-08-30
- **Status**: Approved
- **Topic**: Multi-Runtime Sandbox Isolation, Socket Probing & Dynamic Runner Execution

---

## 1. Overview & Goals

The Incident Command Deck requires resilient, flexible isolation environments for executing SRE diagnostic scripts, policy simulations, and remediation tools without risking production stability.

This specification defines the multi-runtime sandbox architecture supporting five distinct isolation backends:
1. **Podman Container Exec** (Rootless UNIX socket / CLI fallback)
2. **Docker Container Exec** (Standard UNIX socket `/var/run/docker.sock` / CLI fallback)
3. **Daytona Cloud** (TrueForge native microVMs)
4. **Daytona Dedicated / Self-Hosted** (Private VPC/On-prem Daytona server with custom URL and auth token)
5. **Simulated Host Process** (Scoped `/tmp/lupin-sandbox-*` workspace with scrubbed environment and dropped privileges)

---

## 2. Architecture & Unified Strategy Pattern

```
                       ┌──> [ DaytonaRunner ] ──────> TrueForge SDK / Daytona REST API
                       │
[ SandboxManager ] ────┼──> [ PodmanRunner ] ───────> UNIX Socket (/run/user/.../podman.sock) or CLI
(Active Selection)     │
                       ├──> [ DockerRunner ] ───────> UNIX Socket (/var/run/docker.sock) or CLI
                       │
                       └──> [ IsolatedProcessRunner ] > Temp scratch (/tmp/lupin-sandbox-*) + scrubbed env
```

### 2.1 Core Contracts (`src/sandboxes/types.ts`)

```ts
export type SandboxType =
  | "daytona"
  | "daytona-custom"
  | "podman"
  | "docker"
  | "isolated-local";

export interface SandboxProbeResult {
  available: boolean;
  type: SandboxType;
  socketPath?: string;
  serverUrl?: string;
  latencyMs?: number;
  error?: string;
  details?: string;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SandboxRunner {
  readonly type: SandboxType;
  probe(config?: { socketPath?: string; serverUrl?: string; apiKey?: string }): Promise<SandboxProbeResult>;
  createSession(sessionId: string, env?: Record<string, string>): Promise<{ sandboxId: string }>;
  exec(sandboxId: string, command: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<SandboxExecResult>;
  destroySession(sandboxId: string): Promise<void>;
}
```

---

## 3. Runner Implementations

### 3.1 UNIX Domain Socket Prober (`src/sandboxes/socket-probe.ts`)
- Direct HTTP requests over UNIX sockets using Node's `http.request({ socketPath, path: "/_ping" })`.
- **Podman**: Probes `/run/user/${UID}/podman/podman.sock` and `/run/podman/podman.sock`.
- **Docker**: Probes `/var/run/docker.sock` and `$DOCKER_HOST`.
- Measures socket ping latency in milliseconds; falls back to CLI binary version checks if socket is unmounted.

### 3.2 Podman & Docker Runners (`src/sandboxes/container-runners.ts`)
- **Session Lifecycle**:
  - `createSession(sessionId)`: Spawns an ephemeral container (default image `alpine:latest`) with mounted workspace `/tmp/lupin-sandbox-${sessionId}:/workspace:rw`.
  - `exec(sandboxId, command)`: Executes command inside container via socket or CLI exec.
  - `destroySession(sandboxId)`: Stops and removes the ephemeral container.

### 3.3 Daytona Dedicated Runner (`src/sandboxes/daytona-runner.ts`)
- Probes `${serverUrl}/health` with `Authorization: Bearer ${apiKey}`.
- Synchronizes with TrueForge SDK via `client.settings.sandboxProviders.createOrUpdate`.

### 3.4 Simulated Host Process Runner (`src/sandboxes/isolated-process-runner.ts`)
- Creates isolated directory `/tmp/lupin-sandbox-${sessionId}` with `0700` permissions.
- Scrubs sensitive environment variables (`*_API_KEY`, `*_SECRET`, `*_TOKEN`, `AWS_*`, `GCP_*`).
- Enforces execution timeout (default 30s) and non-root bounds.

---

## 4. REST API Endpoints (`src/routes/sandbox.ts`)

| Route | Method | Payload | Description |
|---|---|---|---|
| `/api/sandboxes/probes` | `GET` | — | Concurrently probes all 5 sandbox types and returns live statuses |
| `/api/sandboxes/probe/:type` | `POST` | `{ socketPath?, serverUrl?, apiKey? }` | Tests specific runner configuration |
| `/api/settings/sandbox` | `GET` | — | Retrieves current active sandbox settings |
| `/api/settings/sandbox` | `PUT` | `{ type, apiKey?, serverUrl? }` | Persists active sandbox configuration in SQLite `settings` table |
| `/api/sandboxes/exec` | `POST` | `{ command, timeoutMs? }` | Runs test command in active sandbox runner |

---

## 5. UI Integration

### 5.1 FirstRunSetup (`FirstRunSetup.tsx`)
- Fetches `/api/sandboxes/probes` on mount to show live auto-detection indicators next to each dropdown option.
- Dynamic input visibility:
  - `podman` / `docker` ➔ Socket path input with detected default.
  - `daytona-custom` ➔ Dedicated URL input + API Key input.
  - `daytona` ➔ API Key input.
  - `isolated-local` ➔ Ready pill (no inputs required).
- Interactive "Probe & Connect" button to validate and persist sandbox preference.

### 5.2 Settings Dialog & Sandbox Twin
- Settings Dialog `Sandbox Twin` tab displays current runtime metrics and allows swapping runners.
- Live incident board updates sandbox execution state badge (`PODMAN_CONTAINER`, `DOCKER_CONTAINER`, `DAYTONA_VM`, `HOST_ISOLATED`).

---

## 6. Testing Strategy

1. **Unit Tests**:
   - `socket-probe.test.ts`: Tests socket ping handling, timeouts, and CLI fallback logic.
   - `isolated-process.test.ts`: Verifies environment variable scrubbing, temp directory isolation, and timeout limits.
   - `sandbox-routes.test.ts`: Validates all REST API endpoints using mock runners.
2. **Integration Verification**:
   - Full suite test with `npm test`.
   - Dashboard TypeScript compilation and Vite production build.
