import { Poke, getToken, isLoggedIn, login } from "poke";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const CONFIG_DIR = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const AGENTS_DIR = join(CONFIG_DIR, "poke-gate", "agents");

const SYSTEM_PROMPT = `Generate a Poke Gate agent based on my description below.

Write the COMPLETE JavaScript code using the write_file tool to save it directly to the agents folder.

RULES:
- Save to: ~/.config/poke-gate/agents/<name>.<interval>.js
- Valid ES module with imports.
- Start with JSDoc frontmatter: @agent, @name, @description, @interval, @author.
- Use: import { Poke, getToken } from "poke";
- Auth: const token = getToken(); const poke = new Poke({ apiKey: token });
- Send results: await poke.sendMessage("...");
- Shell commands: import { execSync } from "node:child_process";
- State files: ~/.config/poke-gate/agents/.<agent-name>-state.json
- Only send to Poke when something changed (use state files).
- Handle errors with try/catch. Log with console.log().
- Keep under 100 lines. Intervals: 10m, 30m, 1h, 2h, 6h, 12h, 24h.
- If secrets needed, read from process.env (from .env.<name> file).

EXAMPLE agent (battery monitor):
/**
 * @agent battery
 * @name Battery Guardian
 * @description Alerts via Poke when battery drops below 20%.
 * @interval 30m
 */
import { Poke, getToken } from "poke";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const token = getToken();
if (!token) { console.error("Not signed in."); process.exit(1); }
const STATE = join(homedir(), ".config", "poke-gate", "agents", ".battery-state.json");
function load() { try { return JSON.parse(readFileSync(STATE, "utf-8")); } catch { return {}; } }
function save(s) { writeFileSync(STATE, JSON.stringify(s)); }
const out = execSync("pmset -g batt", { encoding: "utf-8" });
const level = parseInt(out.match(/(\\d+)%/)?.[1] || "100");
const charging = out.includes("AC Power");
const state = load();
if (level <= 20 && !charging && !state.alerted) {
  await new Poke({ apiKey: token }).sendMessage("Battery: " + level + "%, not charging.");
  save({ alerted: true });
} else if (level > 20 || charging) { if (state.alerted) save({ alerted: false }); }

Now use the write_file tool via Poke Gate to save the generated agent code. After writing, tell me the file name and what the agent does.
If you cannot reach out the tunnel, you can send the code via iMessage, Telegram, or SMS.

IMPORTANT: Now write me immediately, before starting that you will write the agent code now and save to your file.
IMPORTANT: If you have questions to clarify, ask me first.
IMPORTANT: When you finish writing the agent code, tell user that you created the agent and saved to the file.

My request: `;

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function createAgent(promptArg) {
  if (!isLoggedIn()) {
    console.log("  Signing in to Poke...");
    await login();
  }

  const token = getToken();
  if (!token) {
    console.error("  Not signed in. Run: npx poke login");
    process.exit(1);
  }

  const prompt = promptArg || await ask("\n  Describe the agent you want to create:\n  > ");
  if (!prompt) {
    console.error("  No description provided.");
    process.exit(1);
  }

  console.log("\n  Sending request to Poke...");
  console.log("  Poke will generate the code and save it using the write_file tool.\n");

  const poke = new Poke({ apiKey: token });
  await poke.sendMessage(SYSTEM_PROMPT + prompt);

  console.log("  Request sent! Poke will write the agent file to:");
  console.log(`  ${AGENTS_DIR}/<name>.<interval>.js\n`);
  console.log("  Watch for Poke's confirmation in your chat.");
  console.log("  Once created, test it: npx poke-gate run-agent <name>\n");
}
