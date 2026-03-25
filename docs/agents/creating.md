# Creating Agents

There are two ways to create agents: **ask Poke to generate one** (recommended) or write one manually.

## Generate with AI

The fastest way — describe what you want and Poke writes the code for you:

```bash
npx poke-gate agent create --prompt "monitor disk space and alert when above 85%"
```

Or interactively:

```bash
npx poke-gate agent create
> Describe the agent you want to create:
> track my git repos for uncommitted changes
```

Poke generates the complete agent code and saves it directly to your agents folder using the `write_file` tool (requires poke-gate to be running). You'll get a confirmation in your chat when it's done.

You can also generate agents from the **macOS app** — open Agents, click "Generate with AI", type your description, and Poke does the rest.

::: tip
Poke may ask clarifying questions before writing the code. Just reply in your chat and it will proceed.
:::

## Write manually

If you prefer to write agents yourself, follow the steps below.

## Step 1: Create the file

Agents live in `~/.config/poke-gate/agents/`. Create a file with the naming convention `name.interval.js`:

```bash
touch ~/.config/poke-gate/agents/hello.1h.js
```

This creates an agent called "hello" that runs every hour.

## Step 2: Add frontmatter

Start with the frontmatter block. This is optional but recommended — it's displayed in the macOS Agents editor.

```javascript
/**
 * @agent hello
 * @name Hello World
 * @description Sends a greeting to Poke every hour.
 * @interval 1h
 * @author you
 */
```

## Step 3: Write your logic

Agents are standard Node.js ESM scripts. They can import the Poke SDK and any globally installed packages.

```javascript
/**
 * @agent hello
 * @name Hello World
 * @description Sends a greeting to Poke every hour.
 * @interval 1h
 */

import { Poke, getToken } from "poke";

const token = getToken();
if (!token) {
  console.error("Not signed in. Run: npx poke login");
  process.exit(1);
}

const poke = new Poke({ apiKey: token });
await poke.sendMessage("Hello! This is an automated message from my Hello agent.");

console.log("Sent greeting to Poke.");
```

## Step 4: Add env variables (optional)

If your agent needs secrets (API tokens, URLs, etc.), create a `.env.<name>` file:

```bash
nano ~/.config/poke-gate/agents/.env.hello
```

```env
# My custom config
MY_API_KEY=secret_123
```

Then read them in your script:

```javascript
const apiKey = process.env.MY_API_KEY;
```

## Step 5: Test it

Run your agent manually:

```bash
npx poke-gate run-agent hello
```

You should see:

```
[agents] Running agent: hello (hello.1h.js)
[agents] [hello] Sent greeting to Poke.
[agents] [hello] completed
```

## Step 6: Let it run

Start Poke Gate normally. Your agent will be discovered and scheduled:

```bash
npx poke-gate
```

```
[agents] Found 1 agent(s):
  Hello World (every 1h)
[agents] Running agent: hello (hello.1h.js)
```

## Tips

- **Keep agents fast.** They have a 5-minute timeout. If your agent takes longer, it'll be killed.
- **Use `console.log`** for debugging. Output appears in the Poke Gate logs.
- **Handle errors gracefully.** If your agent throws, it logs the error and continues to the next scheduled run.
- **Change the interval** by renaming the file (e.g. `hello.1h.js` → `hello.30m.js`) or using the macOS Agents editor.

## Template

Here's a minimal template to copy:

```javascript
/**
 * @agent my-agent
 * @name My Agent
 * @description What this agent does.
 * @interval 1h
 */

import { Poke, getToken } from "poke";

const poke = new Poke({ apiKey: getToken() });

// Your logic here
const result = "Something useful";

await poke.sendMessage(result);
console.log("Done.");
```
