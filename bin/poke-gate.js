#!/usr/bin/env node

const args = process.argv.slice(2);

const VALID_MODES = ["full", "limited", "sandbox"];

function parseMode() {
  const idx = args.indexOf("--mode");
  if (idx === -1) return null;
  const value = args[idx + 1];
  if (!value || !VALID_MODES.includes(value)) {
    console.error(`Invalid --mode value. Must be one of: ${VALID_MODES.join(", ")}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  if (args[0] === "run-agent") {
    const name = args[1];
    if (!name) {
      console.error("Usage: poke-gate run-agent <name>");
      console.error("Example: poke-gate run-agent beeper");
      process.exit(1);
    }
    const { runAgent } = await import("../src/agents.js");
    await runAgent(name);
  } else if (args[0] === "agent" && args[1] === "get") {
    const name = args[2];
    if (!name) {
      console.error("Usage: poke-gate agent get <name>");
      console.error("Example: poke-gate agent get beeper");
      process.exit(1);
    }
    const { downloadAgent } = await import("../src/agents.js");
    await downloadAgent(name);
  } else if (args[0] === "agent" && args[1] === "create") {
    const promptIdx = args.indexOf("--prompt");
    const prompt = promptIdx !== -1 ? args.slice(promptIdx + 1).join(" ") : args.slice(2).join(" ") || null;
    const { createAgent } = await import("../src/agent-create.js");
    await createAgent(prompt);
  } else if (args[0] === "download-macos") {
    const { downloadMacOSApp } = await import("../src/download-macos.js");
    await downloadMacOSApp();
  } else if (args[0] === "take-screenshot") {
    const { takeScreenshot } = await import("../src/take-screenshot.js");
    await takeScreenshot();
  } else {
    const mode = parseMode();
    if (mode) {
      process.env.POKE_GATE_PERMISSION_MODE = mode;
    }
    await import("../src/app.js");
  }
}

main();
