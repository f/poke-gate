import { PokeTunnel, getToken } from "poke";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const STATE_PATH = join(CONFIG_DIR, "poke-gate", "state.json");

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  mkdirSync(join(CONFIG_DIR, "poke-gate"), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function cleanupOldConnection() {
  const state = loadState();
  if (!state.connectionId) return;

  const token = getToken();
  if (!token) return;
  const base = process.env.POKE_API ?? "https://poke.com/api/v1";

  try {
    await fetch(`${base}/mcp/connections/${state.connectionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {}
}

export async function startTunnel({ mcpUrl, onEvent }) {
  await cleanupOldConnection();

  const token = getToken();
  if (!token) {
    throw new Error("No Poke auth token available for tunnel.");
  }

  const tunnel = new PokeTunnel({
    url: mcpUrl,
    name: "poke-gate",
    token,
    cleanupOnStop: false,
  });

  tunnel.on("connected", (info) => {
    saveState({ connectionId: info.connectionId });
    onEvent("connected", info);
  });
  tunnel.on("disconnected", () => onEvent("disconnected"));
  tunnel.on("error", (err) => onEvent("error", err.message));
  tunnel.on("toolsSynced", ({ toolCount }) => onEvent("tools-synced", toolCount));
  tunnel.on("oauthRequired", ({ authUrl }) => onEvent("oauth-required", authUrl));

  const info = await tunnel.start();
  return { tunnel, info };
}
