/**
 * @agent wifi
 * @name WiFi Logger
 * @description Logs your current WiFi network to Poke so it knows where you are.
 * @interval 30m
 * @author f
 */

import { Poke, getToken } from "poke";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const token = getToken();
if (!token) {
  console.error("Not signed in. Run: npx poke login");
  process.exit(1);
}

const STATE_FILE = join(homedir(), ".config", "poke-gate", "agents", ".wifi-state.json");

function getCurrentNetwork() {
  try {
    const iface = execSync(
      "networksetup -listallhardwareports | awk '/Wi-Fi/{getline; print $2}'",
      { encoding: "utf-8", timeout: 5000 }
    ).trim();

    const ssid = execSync(
      `networksetup -getairportnetwork ${iface || "en0"} 2>/dev/null | sed 's/Current Wi-Fi Network: //'`,
      { encoding: "utf-8", timeout: 5000 }
    ).trim();

    if (ssid.includes("not associated") || !ssid) return null;
    return ssid;
  } catch {
    return null;
  }
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { lastNetwork: null };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

const network = getCurrentNetwork();
const state = loadState();

console.log(`Current WiFi: ${network || "not connected"}`);

if (network && network !== state.lastNetwork) {
  console.log(`Network changed from "${state.lastNetwork}" to "${network}". Notifying Poke...`);

  const poke = new Poke({ apiKey: token });
  await poke.sendMessage(
    `I just connected to WiFi network "${network}". ` +
    (state.lastNetwork
      ? `Previously I was on "${state.lastNetwork}".`
      : `This is the first network I've logged.`) +
    ` Remember this for context about where I am.`
  );

  saveState({ lastNetwork: network });
  console.log("Poke notified.");
} else if (!network && state.lastNetwork) {
  console.log("Disconnected from WiFi. Notifying Poke...");

  const poke = new Poke({ apiKey: token });
  await poke.sendMessage(
    `I've disconnected from WiFi (was on "${state.lastNetwork}"). I might be on the move.`
  );

  saveState({ lastNetwork: null });
  console.log("Poke notified.");
} else {
  console.log("No network change.");
}
