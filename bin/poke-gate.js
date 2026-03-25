#!/usr/bin/env node

const args = process.argv.slice(2);

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
  } else {
    await import("../src/app.js");
  }
}

main();
