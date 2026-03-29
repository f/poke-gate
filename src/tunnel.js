import { PokeTunnel, getToken } from "poke";
import { loadState, saveState } from "./webhook.js";

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function cleanupStaleConnections() {
  const token = getToken();
  if (!token) return;
  const base = process.env.POKE_API ?? "https://poke.com/api/v1";
  const state = loadState();

  const ids = new Set();
  if (state.connectionId) ids.add(state.connectionId);
  if (Array.isArray(state.connectionHistory)) {
    for (const id of state.connectionHistory) ids.add(id);
  }

  if (ids.size === 0) return;

  log(`Cleaning up ${ids.size} old connection(s)…`);

  for (const id of ids) {
    try {
      await fetch(`${base}/mcp/connections/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
  }

  const { webhookUrl, webhookToken } = loadState();
  saveState({ webhookUrl, webhookToken });
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
    cleanupOnStop: true,
  });

  tunnel.on("connected", (info) => {
    const state = loadState();
    const history = state.connectionHistory || [];
    history.push(info.connectionId);
    saveState({
      ...state,
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
