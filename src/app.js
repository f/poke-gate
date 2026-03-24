import { startMcpServer, enableLogging } from "./mcp-server.js";
import { startTunnel } from "./tunnel.js";
import { Poke } from "poke";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
enableLogging(verbose);

function resolveToken() {
  if (process.env.POKE_API_KEY) return process.env.POKE_API_KEY;

  const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");

  try {
    const cfg = JSON.parse(readFileSync(join(configDir, "poke-gate", "config.json"), "utf-8"));
    if (cfg.apiKey) return cfg.apiKey;
  } catch {}

  try {
    const creds = JSON.parse(readFileSync(join(configDir, "poke", "credentials.json"), "utf-8"));
    if (creds.token) return creds.token;
  } catch {}

  return null;
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

const API_KEY = resolveToken();

if (!API_KEY) {
  console.error("No credentials found. Run: npx poke-gate");
  process.exit(1);
}

async function main() {
  log("poke-gate starting...");

  const { port } = await startMcpServer();
  log(`MCP server on port ${port}`);

  const mcpUrl = `http://localhost:${port}/mcp`;

  log("Connecting tunnel to Poke...");
  try {
    await startTunnel({
      apiKey: API_KEY,
      mcpUrl,
      onEvent: (type, data) => {
        switch (type) {
          case "connected":
            log(`Tunnel connected (${data.connectionId})`);
            log("Ready — your Poke agent can now access this machine.");
            notifyPoke(data.connectionId);
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

async function notifyPoke(connectionId) {
  try {
    const poke = new Poke({ apiKey: API_KEY });
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
