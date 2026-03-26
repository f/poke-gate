# Security

::: danger Full shell access
In **full** mode, Poke Gate grants **full shell access** to your Poke agent. Understand the implications before running it — or choose a more restrictive mode.
:::

## Access modes

Poke Gate supports three access modes that control what tools your agent can use:

### Full (default)

All tools are available. Risky actions (`run_command`, `write_file`, `take_screenshot`) require **chat approval** — the agent must ask you in chat before executing, and you approve with a signed token.

### Limited

Only safe, read-only tools are available:

- `read_file`, `read_image`, `list_directory`, `system_info`, `network_speed` work normally
- `run_command` is restricted to a curated allowlist: `ls`, `pwd`, `cat`, `grep`, `find`, `head`, `tail`, `wc`, `sed`, `awk`, `curl`, `jq`, `diff`, and others
- `write_file` and `take_screenshot` are **disabled**
- Dangerous patterns (`sudo`, `rm -rf`, etc.) are always blocked

### Sandbox

Broader command support than Limited, plus commands like `brew`, `node`, `python`, `ffmpeg`, `mkdir`, `cp`, `mv`:

- `run_command` uses macOS `sandbox-exec` to restrict file writes to `~/Downloads` and `/tmp`
- `write_file` and `take_screenshot` are **disabled**
- Dangerous patterns are always blocked

### Setting the mode

**CLI:**

```bash
npx poke-gate --mode limited
npx poke-gate --mode sandbox
```

**Environment variable:**

```bash
POKE_GATE_PERMISSION_MODE=sandbox npx poke-gate
```

**macOS app:** Open Settings and select the access mode. The app restarts automatically when you change it.

## Tool approval flow

In **full** mode, risky tools (`run_command`, `write_file`, `take_screenshot`) use an HMAC-signed approval flow:

1. The agent calls the tool — Poke Gate returns `AWAITING_APPROVAL` with a signed token
2. The agent asks you in chat to approve
3. You approve — the agent re-calls the tool with the approval token
4. Optionally, you can `remember_in_session` (same command) or `remember_all_risky` (all risky tools for the session)

## What protects you

- **Authentication** — only your Poke agent (authenticated via Poke OAuth) can reach the tunnel
- **Tunnel isolation** — the MCP server only listens on `127.0.0.1` (localhost), not exposed to the network
- **Chat approval** — risky tools require explicit approval before execution (in full mode)
- **Access policies** — limited and sandbox modes enforce strict command allowlists
- **Loop guard** — duplicate or recently-failed commands are suppressed to prevent runaway retries
- **No persistent access** — quitting Poke Gate closes the tunnel and deletes the connection
- **Connection cleanup** — old connections are deleted before new ones are created

## Best practices

1. **Choose the right access mode** — use `limited` or `sandbox` if you don't need full shell access.
2. **Only run on trusted machines** — don't run Poke Gate on shared or public computers.
3. **Quit when not needed** — close the app when you don't need remote access.
4. **Review agent scripts** — before installing a community agent, read the code. Agents run with your user permissions.
5. **Keep env files secure** — `.env` files in `~/.config/poke-gate/agents/` may contain API tokens. Don't commit them to git.
6. **Use verbose mode** — run with `--verbose` to see what tools are being called in real time.

## Reporting issues

If you discover a security vulnerability, please email [security@fka.dev](mailto:security@fka.dev) instead of opening a public issue.
