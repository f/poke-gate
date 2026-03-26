# macOS App

Poke Gate includes a native SwiftUI menu bar app for macOS.

## Menu bar

The app runs in the menu bar only — no Dock icon. Click the door icon to see the popover:

- **Status** — green dot when connected, yellow when connecting, red on error
- **Personalized** — shows "Connected to your Poke, name"
- **Recent activity** — last few log entries
- **Action buttons** — Logs, Agents, Settings, Restart/Start, Quit
- **About** — version, GitHub link
- **Setup** — dedicated first-run permission and mode selection view

### Status icons

| Icon | Meaning |
|------|---------|
| 🚪 (open) | Connected |
| 🚪 (closed) | Stopped or connecting |
| ⚠️ | Error |

## Settings

Open Settings from the popover. The settings window shows:

- **Authentication status** — whether you're signed in via Poke OAuth
- **Sign in button** — runs `npx poke login` and opens a browser window
- **Connection status** — current state with a Reconnect button

## Logs

The Logs window shows real-time activity:

- Tool calls are highlighted
- Errors appear in red
- Copy all logs to clipboard
- Clear logs

## Agents Editor

The Agents window provides a built-in editor for managing agent scripts — no external editor needed.

<img src="/agents-editor.png" alt="Agents Editor" style="border-radius: 8px; border: 1px solid var(--vp-c-divider); margin: 16px 0;" />

- **Sidebar** — lists agents by `@name` from frontmatter, with interval badges and descriptions
- **Editor** — native syntax-highlighted code editor for JavaScript and env files
- **Tab bar** — switch between `.js` file and `.env` file
- **Interval editor** — change the schedule by typing a new interval (renames the file automatically)
- **New Agent** — creates a template agent with frontmatter
- **Delete** — right-click to remove an agent and its env file

Learn more about agents in the [Agents documentation](/agents/).

## Auto-start

The app connects automatically on launch if you've previously signed in. If the connection drops, it reconnects after 2 seconds.

## Building from source

Requires macOS 15+ and Xcode 16+.

```bash
git clone https://github.com/f/poke-gate.git
cd poke-gate/clients/Poke\ macOS\ Gate
open Poke\ macOS\ Gate.xcodeproj
```

Hit **Run** in Xcode, or build a universal DMG:

```bash
cd poke-gate
./build.sh
```
