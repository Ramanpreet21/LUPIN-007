const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");

const BACKEND_PORT = 3001;
const TRUEFORGE_PORT = 8790;
const CONTROL_PLANE_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const TRUEFORGE_URL = `http://127.0.0.1:${TRUEFORGE_PORT}`;
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || "http://localhost:3000";

/** @type {import("child_process").ChildProcess | null} */
let trueforgeProc = null;
/** @type {import("child_process").ChildProcess | null} */
let backendProc = null;
let quitting = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure a directory exists (recursive). */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

/** HTTP GET health probe — resolves true when endpoint responds 2xx. */
function probe(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume(); // drain
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Poll a health URL with exponential backoff until ready or timeout. */
async function waitForReady(url, maxWaitMs = 15000) {
  const start = Date.now();
  let delay = 250;
  while (Date.now() - start < maxWaitMs) {
    if (await probe(url)) return true;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 2000);
  }
  return false;
}

/** Gracefully kill a child process (SIGTERM → force-kill after timeout). */
function gracefulKill(child, label, timeoutMs = 3000) {
  if (!child || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch { /* already dead */ }
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timer);
      resolve();
    }
    console.log(`[lupin-007] Sent SIGTERM to ${label} (pid ${child.pid})`);
  });
}

// ---------------------------------------------------------------------------
// Process Management
// ---------------------------------------------------------------------------

/** Resolve the user data directory for persistent storage. */
function getUserDataDir() {
  return path.join(app.getPath("userData"), "data");
}

/** Spawn the TrueForge agent server if not already running externally. */
async function ensureTrueForge() {
  const alive = await probe(`${TRUEFORGE_URL}/api/v1/health`, 1500);
  if (alive) {
    console.log("[lupin-007] TrueForge already running on port", TRUEFORGE_PORT);
    return;
  }

  console.log("[lupin-007] Starting TrueForge server on port", TRUEFORGE_PORT);
  trueforgeProc = spawn("npx", ["@truefoundry/trueforge", "--port", String(TRUEFORGE_PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(TRUEFORGE_PORT), STANDALONE: "true" },
    shell: true,
    detached: false,
  });

  trueforgeProc.stdout?.on("data", (d) => process.stdout.write(`[trueforge] ${d}`));
  trueforgeProc.stderr?.on("data", (d) => process.stderr.write(`[trueforge] ${d}`));
  trueforgeProc.on("exit", (code) => {
    if (!quitting) console.warn(`[lupin-007] TrueForge exited with code ${code}`);
    trueforgeProc = null;
  });

  const ready = await waitForReady(`${TRUEFORGE_URL}/api/v1/health`, 15000);
  if (!ready) console.warn("[lupin-007] TrueForge did not become ready in time; continuing anyway");
}

/** Spawn the backend control plane process. */
async function startBackend() {
  const dataDir = getUserDataDir();
  ensureDir(dataDir);

  const backendEntry = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "dist", "index.js")
    : path.join(__dirname, "..", "..", "dist", "index.js");

  console.log("[lupin-007] Starting backend control plane:", backendEntry);

  backendProc = spawn(process.execPath, [backendEntry, "serve"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      SQLITE_PATH: path.join(dataDir, "incident-deck.db"),
      TRUEFORGE_BASE_URL: TRUEFORGE_URL,
    },
  });

  backendProc.stdout?.on("data", (d) => process.stdout.write(`[backend] ${d}`));
  backendProc.stderr?.on("data", (d) => process.stderr.write(`[backend] ${d}`));
  backendProc.on("exit", (code) => {
    if (!quitting) console.warn(`[lupin-007] Backend exited with code ${code}`);
    backendProc = null;
  });

  const ready = await waitForReady(`${CONTROL_PLANE_URL}/health`, 10000);
  if (!ready) console.warn("[lupin-007] Backend did not become ready in time; continuing anyway");
}

// ---------------------------------------------------------------------------
// Electron Window
// ---------------------------------------------------------------------------

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: "LUPIN-007",
    backgroundColor: "#070b10",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (!app.isPackaged) {
    void window.loadURL(DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(path.join(__dirname, "..", "dist", "public", "index.html"));
  }

  return window;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  await ensureTrueForge();
  await startBackend();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();

  console.log("[lupin-007] Shutting down supervised processes…");
  await Promise.all([
    gracefulKill(backendProc, "backend"),
    gracefulKill(trueforgeProc, "trueforge"),
  ]);
  console.log("[lupin-007] All processes terminated. Exiting.");
  app.exit(0);
});
