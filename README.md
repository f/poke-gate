<p align="center">
  <img src="assets/logo.png" width="128" height="128" alt="Poke Gate icon">
</p>

<h1 align="center">Poke Gate</h1>

<p align="center">
  Give your <a href="https://poke.com">Poke</a> AI assistant hands-on access to your Mac.<br>
  <sub>A community project — not affiliated with Poke or The Interaction Company.</sub>
</p>

<p align="center">
  <a href="https://github.com/f/poke-gate/releases/latest"><img src="https://img.shields.io/github/v/release/f/poke-gate?style=flat-square" alt="Latest Release"></a>
  <a href="https://www.npmjs.com/package/poke-gate"><img src="https://img.shields.io/npm/v/poke-gate?style=flat-square" alt="npm"></a>
  <a href="https://github.com/f/poke-gate/blob/main/LICENSE"><img src="https://img.shields.io/github/license/f/poke-gate?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-macOS%2015%2B-blue?style=flat-square" alt="Platform">
</p>

---

## Just ask Poke from your phone

Run Poke Gate on your Mac. Then message Poke from **iMessage, Telegram, or SMS** and ask it to run commands, read files, take screenshots, and more—all on your machine.

---

## Quick Start

### 1. Get an API key
Visit [poke.com/kitchen/api-keys](https://poke.com/kitchen/api-keys) and grab one.

### 2. Install Poke Gate
Choose one:

**Option A: Homebrew** (easiest)

```bash
brew install f/tap/poke-gate
```

**Option B: Download manually**
Download **Poke.macOS.Gate.dmg** from [Releases](https://github.com/f/poke-gate/releases), open it, drag to Applications. Then run:
```bash
xattr -cr /Applications/Poke\ macOS\ Gate.app
```

**Option C: CLI only** (no menu bar app)
```bash
npx poke-gate
```

### 3. Open it and add your API key
1. Launch **Poke Gate** from your menu bar
2. Click **Settings**
3. Paste your API key and save
4. You'll see a **green dot** when connected ✓

You're ready to go!

## How It Works

When you ask Poke a question that needs your machine:

```
You ask Poke over iMessage/Telegram
           ↓
Poke's AI figures out what tool to use
           ↓
"Hey Poke Gate, run this command"
           ↓
Poke Gate on your Mac runs it locally
           ↓
Result comes back to your chat
```

**In more detail:**
- Poke Gate runs as a local MCP server on your Mac
- It tunnels through a secure WebSocket to Poke's cloud
- When you ask Poke something that needs your machine, the agent calls the tools
- Poke Gate executes them locally (no cloud processing of your data)
- Results flow back through the tunnel to your chat

---

## What Can Poke Do?

Every time you message Poke, these tools are available on your machine:

| Tool | What you can do |
|------|-----------------|
| `run_command` | Execute shell commands (ls, git, brew, python, curl, etc.) |
| `read_file` | Read any text file |
| `read_image` | Read images and get their content |
| `write_file` | Create or edit files |
| `list_directory` | See what's in a folder |
| `system_info` | Check OS, hostname, architecture, uptime, memory |
| `take_screenshot` | Capture your screen (requires Accessibility permission) |

### Example Conversations

Just ask Poke from iMessage, Telegram, or SMS:

- _"What's running on port 3000?"_
- _"Show me the last 5 git commits"_
- _"How much disk space is left?"_
- _"Read my ~/.zshrc and suggest improvements"_
- _"Take a screenshot"_
- _"Create a file called notes.txt on my Desktop"_

---

## The Menu Bar App

Once you have Poke Gate running, a menu bar app gives you full control:

**Status indicator**
- 🟢 Green dot = connected and ready
- 🟡 Yellow = connecting
- 🔴 Red = error (check Logs)

**Auto-connect** — connects on launch if your API key is saved

**Auto-reconnect** — automatically restarts if the connection drops

**Settings** — paste or update your API key anytime

**Logs** — watch real-time tool calls and connection events

**Permissions** — first launch prompts for Accessibility access to enable UI automation and screen capture.

**Quit** — the only way to stop (it runs in menu bar only, no Dock icon)

### Building from source

Want to customize it? You'll need macOS 15+ and Xcode 15+:

```bash
git clone https://github.com/f/poke-gate.git
cd poke-gate/clients/Poke\ macOS\ Gate
open Poke\ macOS\ Gate.xcodeproj
```

Then hit **Run** in Xcode, or from the command line:
```bash
./build.sh
```

## CLI Mode

Prefer the terminal over menu bar? Use the CLI version instead:

```bash
npx poke-gate
```

On first run, paste your API key when prompted. It's saved to `~/.config/poke-gate/config.json`.

**See more details in real-time:**
```bash
npx poke-gate --verbose
```

---

## Agents — Automatic Scheduled Tasks

Agents are little scripts that run automatically on your Mac at a set interval. Perfect for scheduled health checks, backups, reports, or anything you want running in the background.

Agents live in `~/.config/poke-gate/agents/` and follow a simple naming pattern:

```
<name>.<interval>.js
```

**Examples:**
| File | Runs |
|------|------|
| `beeper.1h.js` | Every hour |
| `backup.2h.js` | Every 2 hours |
| `health.10m.js` | Every 10 minutes |
| `cleanup.30m.js` | Every 30 minutes |

Minimum interval is 10 minutes. Use `m` for minutes or `h` for hours.

### Use a community agent

Download pre-made agents from our repository:

```bash
npx poke-gate agent get beeper
```

This downloads `beeper.1h.js` and `.env.beeper` to your agents folder. Each agent can have its own `.env` file for secrets.

**Test it first:**
```bash
nano ~/.config/poke-gate/agents/.env.beeper
npx poke-gate run-agent beeper
```

### Create your own agent

An agent is just a JavaScript file that runs with Node.js. You get access to:
- `process.env` — variables from `.env.<name>`
- `poke` package — to send messages back to Poke
- Any npm package installed globally or via npx

**Minimal example:**
```javascript
/**
 * @agent my-agent
 * @name My Custom Agent
 * @description Does something useful every 30 minutes.
 * @interval 30m
 */

import { Poke, getToken } from "poke";

const poke = new Poke({ apiKey: getToken() });
await poke.sendMessage("Hello from my agent!");
```

Save it to `~/.config/poke-gate/agents/my-agent.30m.js` and it runs automatically when poke-gate connects.

**Agent frontmatter** (the comment at the top):
```javascript
/**
 * @agent beeper                    // Internal name (filename without .js)
 * @name Beeper Message Digest      // Human-readable name
 * @description Fetches messages... // What it does
 * @interval 1h                     // How often it runs
 * @env BEEPER_TOKEN                // Required env variables
 * @author f                        // Your name
 */
```

**Environment variables:**
Create a `.env.<name>` file next to your agent:

```
~/.config/poke-gate/agents/.env.beeper
```

```env
BEEPER_TOKEN=your_token_here
SLACK_WEBHOOK=https://hooks.slack.com/...
```

Variables are automatically injected into your agent process.

---

## Security & Privacy

**⚠️ Important:** Poke Gate grants your Poke agent full shell access to your Mac. This means:

- Any command can run with your user's permissions
- Files can be read and written anywhere you have access  
- **Only your Poke agent** (authenticated by your API key) can reach the tunnel

**Only use Poke Gate on machines and networks you trust.**

Your data never leaves your machine during execution — the tunnel just coordinates between Poke and your local Poke Gate server.

---

## Project Structure

```
clients/
  Poke macOS Gate/       macOS menu bar app (SwiftUI)
bin/
  poke-gate.js           CLI entry point + agent commands
src/
  app.js                 Startup: MCP server + tunnel + scheduler
  agents.js              Agent discovery & scheduling
  mcp-server.js          JSON-RPC MCP handler with OS tools
  tunnel.js              PokeTunnel wrapper
examples/
  agents/                Example agents you can adapt
```

---

## Credits & License

- Built for [Poke](https://poke.com) by [The Interaction Company of California](https://interaction.co)
- Uses [Poke SDK](https://www.npmjs.com/package/poke)
- MIT License
