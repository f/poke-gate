import { startMcpServer, enableLogging } from "./mcp-server.js";
import { startTunnel } from "./tunnel.js";
import { startAgentScheduler, stopAgentScheduler } from "./agents.js";
import { Poke, isLoggedIn, login, getToken } from "poke";

const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
enableLogging(verbose);

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureAuthenticated() {
  if (!isLoggedIn()) {
    log("Signing in to Poke...");
    await login();
  }

  const token = getToken();
  if (!token) {
    throw new Error("Authentication failed: no token returned by Poke SDK.");
  }

  return token;
}

let currentTunnel = null;
let reconnectTimer = null;
let reconnectWatchdog = null;

async function connectWithRetry(mcpUrl, token) {
  let attempt = 0;
  const maxDelay = 60_000;

  while (true) {
    attempt++;
    const delay = Math.min(2000 * Math.pow(2, attempt - 1), maxDelay);

    try {
      log(attempt > 1 ? `Reconnecting tunnel (attempt ${attempt})…` : "Connecting tunnel to Poke...");

      const { tunnel } = await startTunnel({
        mcpUrl,
        onEvent: (type, data) => {
          switch (type) {
            case "connected":
              attempt = 0;
              clearTimeout(reconnectWatchdog);
              reconnectWatchdog = null;
              log(`Tunnel connected (${data.connectionId})`);
              log("Ready — your Poke agent can now access this machine.");
              notifyPoke(data.connectionId, token);
              startAgentScheduler();
              break;
            case "disconnected":
              log("Tunnel disconnected.");
              scheduleReconnect(mcpUrl, token);
              break;
            case "error":
              log(`Tunnel error: ${data}`);
              break;
            case "tools-synced":
              log(`Tools synced: ${data}`);
              break;
            case "oauth-required":
              log(`OAuth required: ${data}`);
              break;
          }
        },
      });

      currentTunnel = tunnel;
      return;
    } catch (err) {
      log(`Tunnel failed: ${err.message}`);
      log(`Retrying in ${Math.round(delay / 1000)}s…`);
      await sleep(delay);
    }
  }
}

function scheduleReconnect(mcpUrl, token) {
  if (reconnectWatchdog) return;

  log("Waiting 15s for automatic reconnect…");
  reconnectWatchdog = setTimeout(async () => {
    reconnectWatchdog = null;
    log("No reconnect after 15s — creating a fresh tunnel.");

    if (currentTunnel) {
      try { await currentTunnel.stop(); } catch {}
      currentTunnel = null;
    }

    stopAgentScheduler();
    await connectWithRetry(mcpUrl, token);
  }, 15_000);
}

async function main() {
  log("poke-gate starting...");

  const token = await ensureAuthenticated();

  const { port } = await startMcpServer();
  log(`MCP server on port ${port}`);

  const mcpUrl = `http://localhost:${port}/mcp`;

  await connectWithRetry(mcpUrl, token);
}

async function notifyPoke(connectionId, token) {
  try {
    const poke = new Poke({ token });
    await poke.sendMessage(
      `Hey! I've connected my computer to you via Poke Gate (tunnel: ${connectionId}). ` +
      `You can now run commands, read and write files, list directories, take screenshots, and check system info on my machine. ` +
      `Just use the tools whenever I ask you to do something on my computer.` +
      `Now reply me in my language "now I am connected to your computer".`
    );
    log("Notified Poke agent about connection.");
  } catch (err) {
    log(`Failed to notify Poke: ${err.message}`);
  }
}

process.on("SIGINT", () => {
  log("Shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Shutting down...");
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.message}`);
});

process.on("unhandledRejection", (err) => {
  log(`Unhandled rejection: ${err instanceof Error ? err.message : String(err)}`);
});

main();
