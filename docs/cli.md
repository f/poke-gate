# CLI Reference

## Start the gate

```bash
npx poke-gate
```

Starts the MCP server, connects the tunnel, and begins the agent scheduler. On first run, if you're not signed in, opens Poke OAuth in your browser.

### Verbose mode

```bash
npx poke-gate --verbose
# or
npx poke-gate -v
```

Shows real-time tool calls:

```
[14:52:01] tool: run_command
[14:52:01]   $ ls -la ~/Code
[14:52:03] tool: read_file
[14:52:03]   read: ~/.zshrc
```

## Run an agent

```bash
npx poke-gate run-agent <name>
```

Runs a single agent script immediately and exits. Useful for testing.

**Example:**

```bash
npx poke-gate run-agent beeper
```

Finds `~/.config/poke-gate/agents/beeper.*.js` and runs it with the env from `.env.beeper`.

## Generate an agent with AI

```bash
npx poke-gate agent create --prompt "<description>"
```

Sends your description to Poke with detailed instructions and examples. Poke generates the agent code and saves it directly to `~/.config/poke-gate/agents/` using the `write_file` tool.

**Requires poke-gate to be running** (so Poke can use the `write_file` tool through the tunnel).

**Interactive mode:**

```bash
npx poke-gate agent create
```

**Examples:**

```bash
npx poke-gate agent create --prompt "alert me when disk space is above 85%"
npx poke-gate agent create --prompt "send me a daily git commit summary across all repos"
npx poke-gate agent create --prompt "track Spotify listening and log my music taste"
```

## Install an agent

```bash
npx poke-gate agent get <name>
```

Downloads an agent from the [community repository](https://github.com/f/poke-gate/tree/main/examples/agents) and saves it to `~/.config/poke-gate/agents/`.

If the agent has an `.env` file, you'll be prompted to fill in the values:

```
Fetching agent "beeper" from GitHub...
  Saved: ~/.config/poke-gate/agents/beeper.1h.js

  This agent needs 1 env variable(s):

  BEEPER_TOKEN (Find it in Beeper Desktop > Settings > API): <you type>

  Saved: ~/.config/poke-gate/agents/.env.beeper

  Test it: npx poke-gate run-agent beeper
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `POKE_API_KEY` | Override the API key (skips OAuth) |
| `POKE_API` | Override the Poke API base URL |
| `POKE_FRONTEND` | Override the Poke frontend URL |
