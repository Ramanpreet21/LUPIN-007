#!/usr/bin/env node
import { loadConfig, parsePort } from "./config";
import { createLogger, type Logger } from "./logger";
import { initTrueForge } from "./trueforge";
import { initDb } from "./db";
import { startServer } from "./server";
import { createIncidentRouter } from "./incident-plane";
import { createSandboxRouter } from "./routes/sandbox";
import { createDemoRouter } from "./routes/demo";
import { createPolicyRouter } from "./routes/policy";
import { createFleetRouter } from "./routes/fleet";
import { createModelsRouter } from "./routes/models";
import { createModelRouter } from "./routes/model";
import { runTrueForgeSetup } from "./trueforge-setup";
import { buildLocalMcpUrl } from "./mcp-provider";

const USAGE = `incident-agent - Incident Command Deck local control plane

Usage:
  incident-agent serve [--port <number>] [--host <addr>]

Commands:
  serve               Start the control plane (HTTP + WebSocket) [default]

Options:
  -p, --port <number> Port to listen on (default 3000, or $PORT)
  -H, --host <addr>   Host/IP to bind (default 127.0.0.1, or $HOST)
`;

interface ParsedArgs {
  command: string;
  port?: number;
  host?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: "serve" };
  const help = ["--help", "-h"];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (help.includes(arg)) {
      console.error(USAGE);
      process.exit(0);
    } else if (arg === "--port" || arg === "-p") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      const port = parsePort(value);
      if (port === undefined) throw new Error(`invalid port: ${value}`);
      out.port = port;
    } else if (arg === "--host" || arg === "-H") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      out.host = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      out.command = arg;
    }
  }
  return out;
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    console.error(USAGE);
    process.exit(1);
  }

  if (args.command !== "serve") {
    console.error(`error: unknown command '${args.command}'`);
    console.error(USAGE);
    process.exit(1);
  }

  const config = loadConfig(process.env, { port: args.port, host: args.host });
  const logger: Logger = createLogger(config.logLevel);

  const db = initDb();

  const tf = initTrueForge(
    { baseUrl: config.trueforgeBaseUrl, token: config.trueforgeToken },
    logger,
  );

  initDb();

  let server;
  try {
    server = await startServer({
      host: config.host,
      port: config.port,
      logger,
      getStatus: () => tf.status,
      registerRoutes: (app, { broadcast }) => {
        app.use(createIncidentRouter({ getTf: () => tf, logger, broadcast, model: config.trueforgeModel }));
        app.use(createSandboxRouter({ getTf: () => tf, logger, broadcast }));
        app.use(createDemoRouter({ logger, broadcast, port: config.port }));
        app.use(createPolicyRouter({ logger }));
        app.use(createFleetRouter({ logger, broadcast }));
        app.use(createModelsRouter({ logger }));
        app.use(createModelRouter({ logger, getTf: () => tf, model: config.trueforgeModel, apiToken: config.controlPlaneApiToken }));
      },
    });
  } catch (err) {
    logger.error({ event: "start_failed", err }, "failed to start server");
    process.exit(1);
  }

  // 5a: auto-configure TrueForge once the server listens — create the model
  // provider from the stored key (if any) and register the local read-only MCP
  // connector. Fire-and-forget and best-effort; never blocks shutdown/boot.
  void runTrueForgeSetup({
    getTf: () => tf,
    logger,
    model: config.trueforgeModel,
    mcpUrl: buildLocalMcpUrl(server.port, config.controlPlaneUrl),
  });

  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      logger.info({ event: "shutdown", signal }, "shutting down");
      void server
        .close()
        .catch((err: unknown) => logger.error({ event: "shutdown_error", err }, "error during shutdown"))
        .finally(() => process.exit(0));
    });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
