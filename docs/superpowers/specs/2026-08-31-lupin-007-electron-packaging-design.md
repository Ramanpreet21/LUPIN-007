# Design Specification: LUPIN-007 Electron Desktop Packaging & Installer

**Date:** 2026-08-31  
**Project Name:** LUPIN-007 (Incident Command Deck)  
**Binary / Command:** `lupin-007`  
**Status:** Approved

---

## 1. Overview & Architecture

LUPIN-007 is packaged as a unified, self-contained Electron desktop application on Linux. The desktop app encapsulates the complete incident response loop:
1. **TrueForge Agent Server (`@truefoundry/trueforge`):** Manages LLM agent reasoning, live token streaming, sandbox microVMs/containers, and MCP connectors (port 8790).
2. **Backend Control Plane:** Node.js Express server + SQLite database + WebSocket stream + TrueForge SDK + Multi-runtime Sandbox supervisor (port 3001).
3. **Frontend UI:** Liquid-glass React/Vite dashboard running inside Electron's secure browser window.

An all-in-one installation script (`install.sh`) builds, packages, and integrates LUPIN-007 directly into the Linux desktop environment (application menu, desktop entry, app icon, and terminal CLI launcher).

```
┌────────────────────────────────────────────────────────────────────────┐
│                      LUPIN-007 Electron Process                        │
│                                                                        │
│  ┌───────────────────────┐          ┌───────────────────────────────┐  │
│  │   Renderer Process    │          │      Supervisor Process       │  │
│  │   (React / Vite UI)   │          │      (electron/main.cjs)      │  │
│  └───────────┬───────────┘          └──────────────┬────────────────┘  │
│              │                                     │                   │
│       HTTP / WebSocket                             │ child_process     │
│       (localhost:3001)                             │ (fork/spawn)      │
│              │                                     │                   │
│  ┌───────────▼─────────────────────────────────────▼────────────────┐  │
│  │                   Backend Node.js Process                        │  │
│  │    - Express Routes & WebSocket (/ws) on :3001                   │  │
│  │    - SQLite DB (~/.config/lupin-007/data/)                       │  │
│  │    - Sandbox Manager & Compose Orchestrator                      │  │
│  │    - TrueForge SDK Client (communicates with :8790)              │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│                                     │ HTTP (localhost:8790)            │
│  ┌──────────────────────────────────▼───────────────────────────────┐  │
│  │               TrueForge Agent Server Process                     │  │
│  │    - npx @truefoundry/trueforge --port 8790                      │  │
│  │    - LLM Inference, Sandboxes & HITL Gate Engine                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Electron Process Supervision (`dashboard/electron/main.cjs`)

### 2.1 Complete Subprocess Lifecycle
- **Startup:**
  1. **TrueForge Check & Spawn:** Check if TrueForge server is already responding at `http://127.0.0.1:8790/api/v1/health` or `:8790`. If not running, spawn `npx @truefoundry/trueforge --port 8790` (or bundled binary) as a background child process.
  2. **Control Plane Spawn:** Locate backend entry point (`dist/index.js` in dev or `resources/backend/dist/index.js` in packaged mode). Set `SQLITE_PATH = path.join(app.getPath('userData'), 'data', 'incident-deck.db')` and spawn with `PORT=3001` and `TRUEFORGE_BASE_URL=http://localhost:8790`.
  3. **Readiness Polling:** Poll health endpoints for both TrueForge (:8790) and Control Plane (:3001) with exponential backoff (up to 10s) before showing the main desktop window.
- **Teardown:**
  - On `app.on('before-quit')`, dispatch `SIGTERM` to both child processes (Control Plane and TrueForge) to ensure clean database checkpoints and container teardown.
  - Enforce a 3-second force-kill timeout fallback to prevent hung background processes.

### 2.2 Native Dependencies & electron-builder
- `better-sqlite3` is bundled and unpacked via `asarUnpack: ["**/better-sqlite3/**"]`.
- `electron-builder` configuration in `dashboard/package.json`:
  - `productName`: `"LUPIN-007"`
  - `appId`: `"io.truefoundry.lupin007"`
  - `linux.target`: `["AppImage", "dir"]`
  - `extraResources`: Bundles the compiled root `dist/` directory and required server dependencies.

---

## 3. Installer Script (`install.sh`)

The root `install.sh` script automates the complete setup:

1. **Prerequisite Verification:**
   - Verify Node.js (>= 20.0.0) and npm/pnpm.
   - Detect container runtime availability (`docker`, `podman`, `docker compose`).
   - Ensure `@truefoundry/trueforge` server CLI is installed and available.
2. **Build Pipeline:**
   - Install and compile root backend: `npm install && npm run build`.
   - Install and compile dashboard frontend: `cd dashboard && pnpm install && pnpm run build`.
   - Package application: `cd dashboard && pnpm electron:pack` (or `pnpm electron:build`).
3. **Desktop & System Integration:**
   - Binary Launcher: Symlink/copy executable to `~/.local/bin/lupin-007`.
   - Application Icon: Install SVG icon to `~/.local/share/icons/hicolor/scalable/apps/lupin-007.svg`.
   - Desktop Entry: Generate `~/.local/share/applications/lupin-007.desktop`:
     ```ini
     [Desktop Entry]
     Name=LUPIN-007
     GenericName=Incident Command Deck
     Comment=AI-Powered SRE Incident Remediation & Control Plane
     Exec=/home/<user>/.local/bin/lupin-007 %U
     Icon=lupin-007
     Terminal=false
     Type=Application
     Categories=Development;System;Utility;
     StartupWMClass=lupin-007
     ```
   - Update desktop database cache (`update-desktop-database ~/.local/share/applications` if available).
4. **Uninstall Support:**
   - Running `./install.sh --uninstall` cleanly removes `~/.local/bin/lupin-007`, `~/.local/share/applications/lupin-007.desktop`, and app icons.

---

## 4. Verification & Testing Strategy

1. **Build Verification:**
   - `npm run build` passes for root control plane.
   - `pnpm build` passes for dashboard.
   - `pnpm electron:pack` builds Linux executable directory without native ABI errors.
2. **Lifecycle Testing:**
   - Launch `lupin-007` from CLI: Verify TrueForge starts on port 8790, backend starts on port 3001, and UI loads.
   - Close window: Verify both backend and TrueForge processes exit cleanly and release ports 3001 and 8790.
   - Test rerun: Verify database data is retained in `~/.config/lupin-007/data/`.
