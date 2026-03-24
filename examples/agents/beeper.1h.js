/**
 * Beeper Agent — runs every 1 hour
 *
 * Fetches messages from the last hour via Beeper Desktop's local API,
 * groups them by sender, and sends a summary to your Poke agent.
 *
 * Setup:
 *   1. Copy this file to ~/.config/poke-gate/agents/beeper.1h.js
 *   2. Create ~/.config/poke-gate/agents/.env.beeper with:
 *        BEEPER_TOKEN=your_beeper_access_token
 *   3. Run: npx poke-gate run-agent beeper (to test)
 *
 * The token is from Beeper Desktop's local API (localhost:23373).
 * You can find it in Beeper Desktop > Settings > API.
 */

import { Poke, getToken } from "poke";

const BEEPER_BASE = process.env.BEEPER_BASE_URL || "http://localhost:23373";
const BEEPER_TOKEN = process.env.BEEPER_TOKEN;

if (!BEEPER_TOKEN) {
  console.error("BEEPER_TOKEN not set. Create ~/.config/poke-gate/agents/.env.beeper");
  process.exit(1);
}

async function beeperRequest(path, params = {}) {
  const url = new URL(BEEPER_BASE + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BEEPER_TOKEN}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Beeper API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getRecentMessages() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const data = await beeperRequest("/v1/messages/search", {
    dateAfter: oneHourAgo,
    limit: 200,
  });

  return data.items || [];
}

function groupBySender(messages) {
  const groups = {};
  for (const msg of messages) {
    if (msg.isSender) continue;
    const name = msg.senderName || msg.senderID || "Unknown";
    if (!groups[name]) groups[name] = [];
    if (msg.text) groups[name].push(msg.text);
  }
  return groups;
}

function buildSummary(groups) {
  const senders = Object.keys(groups);
  if (senders.length === 0) return null;

  let summary = `Messages from the last hour (${senders.length} people):\n\n`;

  for (const [sender, messages] of Object.entries(groups)) {
    summary += `${sender} (${messages.length} messages):\n`;
    for (const text of messages.slice(-3)) {
      const preview = text.length > 100 ? text.slice(0, 100) + "…" : text;
      summary += `  - ${preview}\n`;
    }
    summary += "\n";
  }

  return summary.trim();
}

async function main() {
  console.log("Fetching messages from the last hour...");

  const messages = await getRecentMessages();
  console.log(`Found ${messages.length} messages`);

  const groups = groupBySender(messages);
  const summary = buildSummary(groups);

  if (!summary) {
    console.log("No new messages from others in the last hour.");
    return;
  }

  console.log("Sending summary to Poke...");

  const token = getToken();
  if (!token) {
    console.error("Not logged in to Poke. Run: npx poke login");
    process.exit(1);
  }

  const poke = new Poke({ apiKey: token });
  await poke.sendMessage(
    `Here's a summary of my Beeper messages from the last hour:\n\n${summary}`
  );

  console.log("Summary sent to Poke.");
}

main().catch((err) => {
  console.error("Agent error:", err.message);
  process.exit(1);
});
