import { startMcpServer, enableLogging } from "./mcp-server.js";
import { startTunnel } from "./tunnel.js";
import { Poke, isLoggedIn, login, getToken } from "poke";

const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
enableLogging(verbose);

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
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

async function main() {
  log("poke-gate starting...");

  const token = await ensureAuthenticated();

  const { port } = await startMcpServer();
  log(`MCP server on port ${port}`);

  const mcpUrl = `http://localhost:${port}/mcp`;

  log("Connecting tunnel to Poke...");
  try {
    await startTunnel({
      mcpUrl,
      onEvent: (type, data) => {
        switch (type) {
          case "connected":
            log(`Tunnel connected (${data.connectionId})`);
            log("Ready — your Poke agent can now access this machine.");
            notifyPoke(data.connectionId, token);
            break;
          case "disconnected":
            log("Tunnel disconnected. Reconnecting...");
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
  } catch (err) {
    log(`Failed to connect: ${err.message}`);
    process.exit(1);
  }
}

async function notifyPoke(connectionId, token) {
  try {
    const poke = new Poke({ token });
    await poke.sendMessage(
      `Poke macOS Gate is connected. Tunnel ID: ${connectionId}. ` +
      `You now have access to this machine's terminal, files, and screen. ` +
      `Use the available tools (run_command, read_file, write_file, list_directory, system_info, read_image, take_screenshot) to help the user.`
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

main();
