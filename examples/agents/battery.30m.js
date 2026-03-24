/**
 * @agent battery
 * @name Battery Guardian
 * @description Alerts you via Poke when your battery drops below 20%.
 * @interval 30m
 * @author f
 */

import { Poke, getToken } from "poke";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const token = getToken();
if (!token) {
  console.error("Not signed in. Run: npx poke login");
  process.exit(1);
}

const THRESHOLD = parseInt(process.env.BATTERY_THRESHOLD || "20", 10);
const STATE_FILE = join(homedir(), ".config", "poke-gate", "agents", ".battery-state.json");

function getBattery() {
  try {
    const output = execSync("pmset -g batt", { encoding: "utf-8", timeout: 5000 });
    const match = output.match(/(\d+)%/);
    const charging = output.includes("AC Power") || output.includes("charging");
    return {
      level: match ? parseInt(match[1], 10) : null,
      charging,
    };
  } catch {
    return { level: null, charging: false };
  }
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { alerted: false };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

const { level, charging } = getBattery();

if (level === null) {
  console.log("Could not read battery level.");
  process.exit(0);
}

console.log(`Battery: ${level}% ${charging ? "(charging)" : "(on battery)"}`);

const state = loadState();

if (level <= THRESHOLD && !charging && !state.alerted) {
  console.log(`Battery low (${level}%). Alerting Poke...`);

  const poke = new Poke({ apiKey: token });
  await poke.sendMessage(
    `⚠️ Battery alert: your Mac is at ${level}%. You're not plugged in. Consider charging soon.`
  );

  saveState({ alerted: true });
  console.log("Alert sent.");
} else if (level > THRESHOLD || charging) {
  if (state.alerted) {
    saveState({ alerted: false });
    console.log("Battery recovered, reset alert state.");
  } else {
    console.log("Battery OK, no alert needed.");
  }
}
