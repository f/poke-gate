---
layout: home

hero:
  name: Poke Gate
  text: A two-way bridge between your Mac and your AI.
  tagline: Poke pulls from your Mac when you ask. Your Mac pushes to Poke when something happens. Run commands, read files, take screenshots — and automate it all with Agents.
  image:
    src: /logo.png
    alt: Poke Gate
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/f/poke-gate

features:
  - icon: 🖥️
    title: Full Shell Access
    details: Run any terminal command on your machine — ls, git, brew, python, curl, and more.
  - icon: 📁
    title: File Operations
    details: Read, write, and list files and directories. Your Poke agent sees your filesystem.
  - icon: 📸
    title: Screenshots
    details: Capture your screen remotely. Poke can see what you see.
  - icon: 🤖
    title: Agents
    details: Scheduled scripts that run in the background — automate message digests, backups, health checks.
  - icon: 🌴
    title: macOS Menu Bar App
    details: Native SwiftUI app that lives in your menu bar. Auto-connects, auto-restarts, shows real-time status.
  - icon: ⚡
    title: MCP Tunnel
    details: Secure WebSocket tunnel powered by the Poke SDK. Only your authenticated agent can reach your machine.
---

## Quick install

::: code-group

```bash [Homebrew]
brew install f/tap/poke-gate
```

```bash [npm]
npx poke-gate
```

```bash [Manual]
# Download from GitHub Releases
# https://github.com/f/poke-gate/releases/latest
```

:::

<br>

::: tip Community project
Poke Gate is open source and not affiliated with Poke or The Interaction Company of California.
:::
