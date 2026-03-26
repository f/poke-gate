import { PokeTunnel, getToken } from "poke";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const STATE_PATH = join(CONFIG_DIR, "poke-gate", "state.json");

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

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

async function cleanupStaleConnections() {
  const token = getToken();
  if (!token) return;
  const base = process.env.POKE_API ?? "https://poke.com/api/v1";

  try {
    const res = await fetch(`${base}/mcp/connections`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;

    const connections = await res.json();
    const stale = (Array.isArray(connections) ? connections : [])
      .filter((c) => c.name === "poke-gate" && c.id);

    if (stale.length === 0) return;

    log(`Cleaning up ${stale.length} old connection(s)…`);

    for (const c of stale) {
      try {
        await fetch(`${base}/mcp/connections/${c.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }
  } catch {}

  saveState({});
}

export async function startTunnel({ mcpUrl, onEvent }) {
  await cleanupStaleConnections();

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
    const state = loadState();
    const history = state.connectionHistory || [];
    history.push(info.connectionId);
    saveState({
      connectionId: info.connectionId,
      connectionHistory: history.slice(-10),
    });
    onEvent("connected", info);
  });
  tunnel.on("disconnected", () => onEvent("disconnected"));
  tunnel.on("error", (err) => onEvent("error", err.message));
  tunnel.on("toolsSynced", ({ toolCount }) => onEvent("tools-synced", toolCount));
  tunnel.on("oauthRequired", ({ authUrl }) => onEvent("oauth-required", authUrl));

  const info = await tunnel.start();
  return { tunnel, info };
}
