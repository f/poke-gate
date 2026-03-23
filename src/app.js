import { startMcpServer } from "./mcp-server.js";
import { startTunnel } from "./tunnel.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function resolveToken() {
  if (process.env.POKE_API_KEY) return process.env.POKE_API_KEY;

  const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");

  try {
    const cfg = JSON.parse(readFileSync(join(configDir, "poke-gate", "config.json"), "utf-8"));
    if (cfg.apiKey) return cfg.apiKey;
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
    const { info } = await startTunnel({
      apiKey: API_KEY,
      mcpUrl,
      onEvent: (type, data) => {
        switch (type) {
          case "connected":
            log(`Tunnel connected (${data.connectionId})`);
            log("Ready — your Poke agent can now access this machine.");
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

process.on("SIGINT", () => {
  log("Shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Shutting down...");
  process.exit(0);
});

main();
