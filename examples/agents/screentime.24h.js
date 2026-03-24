/**
 * @agent screentime
 * @name Screen Time Report
 * @description Sends a daily summary of your most-used apps to Poke.
 * @interval 24h
 * @author f
 */

import { Poke, getToken } from "poke";
import { execSync } from "node:child_process";

const token = getToken();
if (!token) {
  console.error("Not signed in. Run: npx poke login");
  process.exit(1);
}

function getScreenTime() {
  try {
    const result = execSync(
      `defaults read com.apple.ScreenTimeAgent 2>/dev/null || echo "{}"`,
      { encoding: "utf-8", timeout: 10000 }
    ).trim();

    // Fallback: use process list to estimate active apps
    const ps = execSync(
      `ps -eo etime,comm | grep -i "/Applications/" | sort -rn | head -20`,
      { encoding: "utf-8", timeout: 10000 }
    ).trim();

    return ps;
  } catch {
    return null;
  }
}

function getActiveApps() {
  try {
    const script = `
      tell application "System Events"
        set appList to name of every application process whose background only is false
      end tell
      return appList as text
    `;
    const result = execSync(`osascript -e '${script}'`, {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    return result.split(", ");
  } catch {
    return [];
  }
}

function getUptime() {
  try {
    return execSync("uptime", { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "unknown";
  }
}

const apps = getActiveApps();
const uptimeStr = getUptime();
const screenData = getScreenTime();

let report = `Daily screen report:\n\n`;
report += `Uptime: ${uptimeStr}\n\n`;

if (apps.length > 0) {
  report += `Currently running apps (${apps.length}):\n`;
  for (const app of apps) {
    report += `  - ${app}\n`;
  }
}

if (screenData) {
  report += `\nTop processes by runtime:\n${screenData}\n`;
}

console.log("Sending screen time report...");

const poke = new Poke({ apiKey: token });
await poke.sendMessage(report);

console.log("Report sent.");
