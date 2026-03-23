import { PokeTunnel, getToken } from "poke";

export async function startTunnel({ apiKey, mcpUrl, onEvent }) {
  const token = getToken();

  const tunnel = new PokeTunnel({
    url: mcpUrl,
    name: "poke-gate",
    token: token || apiKey,
  });

  tunnel.on("connected", (info) => onEvent("connected", info));
  tunnel.on("disconnected", () => onEvent("disconnected"));
  tunnel.on("error", (err) => onEvent("error", err.message));
  tunnel.on("toolsSynced", ({ toolCount }) => onEvent("tools-synced", toolCount));
  tunnel.on("oauthRequired", ({ authUrl }) => onEvent("oauth-required", authUrl));

  const info = await tunnel.start();
  return { tunnel, info };
}
