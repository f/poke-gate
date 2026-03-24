import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { exec } from "node:child_process";

const CONFIG_DIR = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const AGENTS_DIR = join(CONFIG_DIR, "poke-gate", "agents");

const MIN_INTERVAL_MS = 10 * 60 * 1000;

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [agents] ${msg}`);
}

function parseInterval(token) {
  const match = token.match(/^(\d+)(m|h)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const ms = unit === "h" ? value * 60 * 60 * 1000 : value * 60 * 1000;
  if (ms < MIN_INTERVAL_MS) return null;
  return ms;
}

function parseEnvFile(filePath) {
  const env = {};
  if (!existsSync(filePath)) return env;
  const lines = readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function discoverAgents() {
  if (!existsSync(AGENTS_DIR)) {
    mkdirSync(AGENTS_DIR, { recursive: true });
    return [];
  }

  const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".js"));
  const agents = [];

  for (const file of files) {
    const parts = file.replace(/\.js$/, "").split(".");
    if (parts.length < 2) continue;

    const intervalToken = parts[parts.length - 1];
    const name = parts.slice(0, -1).join(".");
    const intervalMs = parseInterval(intervalToken);

    if (!intervalMs) {
      log(`Skipping ${file}: invalid or too short interval (min 10m)`);
      continue;
    }

    agents.push({
      name,
      file,
      path: join(AGENTS_DIR, file),
      intervalToken,
      intervalMs,
      envFile: join(AGENTS_DIR, `.env.${name}`),
    });
  }

  return agents;
}

function runAgentProcess(agent) {
  const agentEnv = parseEnvFile(agent.envFile);
  const env = { ...process.env, ...agentEnv };

  log(`Running agent: ${agent.name} (${agent.file})`);

  return new Promise((resolve) => {
    exec(`node "${agent.path}"`, {
      env,
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024,
      cwd: AGENTS_DIR,
    }, (error, stdout, stderr) => {
      if (stdout.trim()) log(`[${agent.name}] ${stdout.trim()}`);
      if (stderr.trim()) log(`[${agent.name}] stderr: ${stderr.trim()}`);
      if (error) log(`[${agent.name}] exited with code ${error.code ?? 1}`);
      else log(`[${agent.name}] completed`);
      resolve();
    });
  });
}

export async function runAgent(name) {
  const agents = discoverAgents();
  const agent = agents.find((a) => a.name === name);
  if (!agent) {
    const allFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".js"));
    const match = allFiles.find((f) => f.startsWith(name + "."));
    if (match) {
      const parts = match.replace(/\.js$/, "").split(".");
      const intervalToken = parts[parts.length - 1];
      const intervalMs = parseInterval(intervalToken);
      await runAgentProcess({
        name,
        file: match,
        path: join(AGENTS_DIR, match),
        intervalToken,
        intervalMs: intervalMs || 0,
        envFile: join(AGENTS_DIR, `.env.${name}`),
      });
      return;
    }
    console.error(`Agent "${name}" not found in ${AGENTS_DIR}`);
    console.error("Available agents:", agents.map((a) => a.name).join(", ") || "none");
    process.exit(1);
  }
  await runAgentProcess(agent);
}

const REPO_BASE = "https://raw.githubusercontent.com/f/poke-gate/main/examples/agents";

export async function downloadAgent(name) {
  mkdirSync(AGENTS_DIR, { recursive: true });

  console.log(`Fetching agent "${name}" from GitHub...`);

  const indexRes = await fetch(`${REPO_BASE}/`).catch(() => null);

  const jsUrl = `${REPO_BASE}/${name}`;
  const envUrl = `${REPO_BASE}/.env.${name}`;

  // Try to find the exact file first, or search for name.*.js pattern
  let jsFileName = null;
  let jsContent = null;

  // Try direct match (user might pass "beeper.1h.js")
  let res = await fetch(`${REPO_BASE}/${name}`).catch(() => null);
  if (res?.ok) {
    jsFileName = name;
    jsContent = await res.text();
  }

  // Try with .js extension
  if (!jsContent) {
    res = await fetch(`${REPO_BASE}/${name}.js`).catch(() => null);
    if (res?.ok) {
      jsFileName = `${name}.js`;
      jsContent = await res.text();
    }
  }

  // Try common intervals
  if (!jsContent) {
    for (const interval of ["10m", "30m", "1h", "2h", "6h", "12h", "24h"]) {
      res = await fetch(`${REPO_BASE}/${name}.${interval}.js`).catch(() => null);
      if (res?.ok) {
        jsFileName = `${name}.${interval}.js`;
        jsContent = await res.text();
        break;
      }
    }
  }

  if (!jsContent) {
    console.error(`Agent "${name}" not found in the repository.`);
    console.error(`Browse available agents: https://github.com/f/poke-gate/tree/main/examples/agents`);
    process.exit(1);
  }

  const dest = join(AGENTS_DIR, jsFileName);
  writeFileSync(dest, jsContent);
  console.log(`  Saved: ${dest}`);

  // Try to download matching .env file
  const envName = name.split(".")[0];
  const envRes = await fetch(`${REPO_BASE}/.env.${envName}`).catch(() => null);
  if (envRes?.ok) {
    const envContent = await envRes.text();
    const envDest = join(AGENTS_DIR, `.env.${envName}`);
    if (!existsSync(envDest)) {
      writeFileSync(envDest, envContent);
      console.log(`  Saved: ${envDest}`);
      console.log(`\n  Edit the env file with your credentials:`);
      console.log(`    nano ${envDest}`);
    } else {
      console.log(`  .env.${envName} already exists, skipped.`);
    }
  }

  console.log(`\n  Test it: npx poke-gate run-agent ${envName}`);
}

export function startAgentScheduler() {
  const agents = discoverAgents();

  if (agents.length === 0) {
    log("No agents found. Add scripts to ~/.config/poke-gate/agents/");
    return;
  }

  log(`Found ${agents.length} agent(s):`);
  for (const agent of agents) {
    const interval = agent.intervalToken;
    const hasEnv = existsSync(agent.envFile);
    log(`  ${agent.name} (every ${interval}${hasEnv ? ", has .env" : ""})`);
  }

  for (const agent of agents) {
    runAgentProcess(agent);

    setInterval(() => {
      runAgentProcess(agent);
    }, agent.intervalMs);
  }
}
