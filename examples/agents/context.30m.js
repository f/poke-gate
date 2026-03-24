/**
 * @agent context
 * @name Context Fingerprint
 * @description Sends a tiny snapshot of your Mac's state to Poke — volume, battery, WiFi, displays, camera. Maximum context, zero private data.
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

const STATE_FILE = join(homedir(), ".config", "poke-gate", "agents", ".context-state.json");

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")); }
  catch { return {}; }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

function run(cmd) {
  try { return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim(); }
  catch { return null; }
}

function getVolume() {
  const raw = run("osascript -e 'get volume settings'");
  if (!raw) return { volume: null, muted: null };
  const vol = raw.match(/output volume:(\d+)/);
  const muted = raw.includes("output muted:true");
  return { volume: vol ? parseInt(vol[1]) : null, muted };
}

function getBattery() {
  const raw = run("pmset -g batt");
  if (!raw) return { level: null, charging: null };
  const match = raw.match(/(\d+)%/);
  const charging = raw.includes("AC Power") || raw.includes("charging");
  return { level: match ? parseInt(match[1]) : null, charging };
}

function getWifi() {
  const raw = run("networksetup -getairportnetwork en0");
  if (!raw || raw.includes("not associated") || raw.includes("off")) return null;
  return raw.replace("Current Wi-Fi Network: ", "").trim();
}

function getDisplayCount() {
  const raw = run("system_profiler SPDisplaysDataType");
  if (!raw) return 0;
  return (raw.match(/Resolution:/g) || []).length;
}

function getCameraInUse() {
  const raw = run("lsof 2>/dev/null | grep -c 'AppleCamera\\|VDC\\|iSight'");
  return raw && parseInt(raw) > 0;
}

function getBluetoothDevices() {
  const raw = run("system_profiler SPBluetoothDataType 2>/dev/null");
  if (!raw) return [];
  const devices = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Connected: Yes")) {
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const nameMatch = lines[j].match(/^\s{8}(\S.+):$/);
        if (nameMatch) {
          devices.push(nameMatch[1]);
          break;
        }
      }
    }
  }
  return devices;
}

function getUptime() {
  const raw = run("uptime");
  if (!raw) return null;
  const match = raw.match(/up\s+(.+?),\s+\d+ user/);
  return match ? match[1].trim() : null;
}

// Gather all signals
const volume = getVolume();
const battery = getBattery();
const wifi = getWifi();
const displays = getDisplayCount();
const camera = getCameraInUse();
const bluetooth = getBluetoothDevices();
const uptime = getUptime();

const now = new Date();
const hour = now.getHours();
const timeOfDay = hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

const fingerprint = {
  time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
  timeOfDay,
  volume: volume.muted ? "muted" : `${volume.volume}%`,
  battery: `${battery.level}%${battery.charging ? " (charging)" : " (on battery)"}`,
  wifi: wifi || "not connected",
  displays,
  camera: camera ? "in use" : "off",
  bluetooth: bluetooth.length > 0 ? bluetooth.join(", ") : "none",
  uptime: uptime || "unknown",
};

console.log("Context fingerprint:", JSON.stringify(fingerprint, null, 2));

// Check if anything meaningful changed
const state = loadState();
const key = `${fingerprint.volume}|${fingerprint.wifi}|${fingerprint.displays}|${fingerprint.camera}|${fingerprint.battery}`;

if (key === state.lastKey) {
  console.log("No meaningful change, skipping.");
  process.exit(0);
}

saveState({ lastKey: key });

// Build a natural language summary
let summary = `Context update (${fingerprint.time}, ${timeOfDay}):\n`;
summary += `• Volume: ${fingerprint.volume}\n`;
summary += `• Battery: ${fingerprint.battery}\n`;
summary += `• WiFi: ${fingerprint.wifi}\n`;
summary += `• Displays: ${fingerprint.displays}\n`;
summary += `• Camera: ${fingerprint.camera}\n`;
summary += `• Bluetooth: ${fingerprint.bluetooth}\n`;
summary += `• Uptime: ${fingerprint.uptime}\n`;
summary += `\nUse this to understand my current situation without asking.`;

const poke = new Poke({ apiKey: token });
await poke.sendMessage(summary);

console.log("Sent context to Poke.");
