# Getting Started

## Install

### Homebrew

The recommended way to install the macOS app:

```bash
brew install f/tap/poke-gate
```

### Manual download

Download the latest **Poke.macOS.Gate.dmg** from [GitHub Releases](https://github.com/f/poke-gate/releases/latest), open it, and drag to Applications.

Since the app is not notarized, you may need to run:

```bash
xattr -cr /Applications/Poke\ macOS\ Gate.app
```

### CLI only

If you don't need the macOS app:

```bash
npx poke-gate
```

Poke Gate needs **Accessibility** permission on your Mac to automate keyboard/mouse and take screenshots.

### 1. Sign in
Poke Gate uses Poke OAuth to authenticate. On first launch:

1. Open Poke Gate from your menu bar.
2. The **Setup View** will appear to guide you through:
   - Selecting an access mode (Full, Limited, or Sandbox)
   - Granting the required macOS Accessibility permissions
3. If you're not signed in, a browser window opens for Poke OAuth.
4. After signing in, the connection is established.

You can also sign in manually:

```bash
npx poke login
```

## Verify it works

Once connected, you'll see a green dot in the menu bar. The popover shows:

> ● Connected to your Poke, your name

Now open iMessage or Telegram and message your Poke:

> "What's my hostname?"

Poke will use the `system_info` tool to answer from your machine.

## What's next?

- [How It Works](/how-it-works) — understand the architecture
- [Tools](/tools) — see all available tools
- [Agents](/agents/) — set up scheduled automation
