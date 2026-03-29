import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Poke, getToken } from "poke";

const CONFIG_DIR = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const STATE_PATH = join(CONFIG_DIR, "poke-gate", "state.json");

export function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function saveState(state) {
  mkdirSync(join(CONFIG_DIR, "poke-gate"), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export async function getWebhook() {
  const state = loadState();
  if (state.webhookUrl && state.webhookToken) {
    return { webhookUrl: state.webhookUrl, webhookToken: state.webhookToken };
  }

  const token = getToken();
  if (!token) throw new Error("No Poke auth token available.");

  const poke = new Poke({ token });
  const result = await poke.createWebhook({ condition: "poke-gate", action: "poke-gate" });

  const webhook = { webhookUrl: result.webhookUrl, webhookToken: result.webhookToken };
  saveState({ ...state, ...webhook });
  return webhook;
}

export async function sendToWebhook(message) {
  const { webhookUrl, webhookToken } = await getWebhook();
  const poke = new Poke({ token: getToken() });
  return poke.sendWebhook({ webhookUrl, webhookToken, data: { message } });
}
