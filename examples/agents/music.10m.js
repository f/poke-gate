/**
 * @agent music
 * @name Music Log
 * @description Tracks what you're listening to and sends a log to Poke. Supports Apple Music and Spotify.
 * @interval 10m
 * @author f
 */

import { Poke, getToken } from "poke";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const token = getToken();
if (!token) {
  console.error("Not signed in. Run: npx poke login");
  process.exit(1);
}

const STATE_FILE = join(homedir(), ".config", "poke-gate", "agents", ".music-state.json");

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")); }
  catch { return { lastTrack: null }; }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

function getNowPlaying() {
  // Try Spotify first
  try {
    const result = execSync(`osascript -e '
      if application "Spotify" is running then
        tell application "Spotify"
          if player state is playing then
            return name of current track & " — " & artist of current track & " (" & album of current track & ")"
          end if
        end tell
      end if
      return "not_playing"
    '`, { encoding: "utf-8", timeout: 5000 }).trim();
    if (result && result !== "not_playing") return { source: "Spotify", track: result };
  } catch {}

  // Try Apple Music
  try {
    const result = execSync(`osascript -e '
      if application "Music" is running then
        tell application "Music"
          if player state is playing then
            return name of current track & " — " & artist of current track & " (" & album of current track & ")"
          end if
        end tell
      end if
      return "not_playing"
    '`, { encoding: "utf-8", timeout: 5000 }).trim();
    if (result && result !== "not_playing") return { source: "Apple Music", track: result };
  } catch {}

  return null;
}

const playing = getNowPlaying();
const state = loadState();

if (!playing) {
  console.log("Nothing playing right now.");
  process.exit(0);
}

console.log(`Now playing (${playing.source}): ${playing.track}`);

if (playing.track === state.lastTrack) {
  console.log("Same track as last check, skipping.");
  process.exit(0);
}

saveState({ lastTrack: playing.track });

const poke = new Poke({ apiKey: token });
await poke.sendMessage(
  `I'm currently listening to: ${playing.track} (on ${playing.source}). ` +
  `Remember this for context about my mood and taste.`
);

console.log("Sent to Poke.");
