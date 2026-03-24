# Community Agents

Ready-to-use agents you can install with a single command. All agents are open source and included in the [Poke Gate repository](https://github.com/f/poke-gate/tree/main/examples/agents).

## Beeper Message Digest

Fetches messages from the last hour via [Beeper Desktop](https://beeper.com)'s local API, groups them by sender, and sends a summary to Poke. Great for staying on top of conversations across all your messaging platforms without checking each one.

| | |
|---|---|
| **File** | `beeper.1h.js` |
| **Interval** | Every hour |
| **Requires** | Beeper Desktop running, API token |

```bash
npx poke-gate agent get beeper
```

[Full documentation →](/agents/beeper)

---

## Screen Time Report

Sends a daily summary of your Mac usage — currently running apps, uptime, and top processes. Poke learns your work patterns and can answer questions like "what was I doing yesterday?" or "how long have I been working today?".

| | |
|---|---|
| **File** | `screentime.24h.js` |
| **Interval** | Every 24 hours |
| **Requires** | Nothing — works out of the box |

```bash
npx poke-gate agent get screentime
```

---

## Battery Guardian

Monitors your battery and alerts you via Poke when it drops below 20% on battery power. Only alerts once per discharge cycle — won't spam you. Resets when you plug in.

| | |
|---|---|
| **File** | `battery.30m.js` |
| **Interval** | Every 30 minutes |
| **Requires** | Nothing — works out of the box |

```bash
npx poke-gate agent get battery
```

::: tip Custom threshold
Set `BATTERY_THRESHOLD` in `.env.battery` to change the alert level (default: 20%).
:::

---

## WiFi Logger

Tracks which WiFi network you're on and notifies Poke when you switch networks or disconnect. This gives Poke passive context about your location — it knows if you're at home, at the office, or at a cafe without you telling it.

| | |
|---|---|
| **File** | `wifi.30m.js` |
| **Interval** | Every 30 minutes |
| **Requires** | Nothing — works out of the box |

```bash
npx poke-gate agent get wifi
```

---

## Want more?

Check the [Sharing Agents](/agents/sharing) page for ideas and instructions on contributing your own agent to the community.
