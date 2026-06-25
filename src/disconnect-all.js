import { getPokeBrowserSessionToken } from './browser-session-token.js';

const DEFAULT_DELAY_MS = 100;
const DEFAULT_CONNECTION_NAME = 'poke-gate';
const DEFAULT_API_BASE = 'https://poke.com/api/v1';

function log(message) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseDisconnectAllArgs(args) {
  const options = {
    delayMs: DEFAULT_DELAY_MS,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--delay') {
      const value = args[++i];
      const delayMs = Number(value);
      if (!Number.isFinite(delayMs) || delayMs < 0) {
        throw new Error('Invalid --delay value. Use milliseconds, for example: --delay 100');
      }
      options.delayMs = delayMs;
    } else {
      throw new Error(`Unknown disconnect-all option: ${arg}`);
    }
  }

  return options;
}

function getApiBase(env = process.env) {
  return env.POKE_API ?? DEFAULT_API_BASE;
}

function getRetryAfterMs(headers, fallbackMs) {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return fallbackMs;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return fallbackMs;
}

function normalizeConnections(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.connections)) return payload.connections;
  throw new Error('Unexpected Poke connections response shape.');
}

async function fetchConnections({ token, fetchImpl = fetch, baseUrl = getApiBase() }) {
  const response = await fetchImpl(`${baseUrl}/mcp/connections`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch connections (${response.status}): ${await response.text()}`);
  }

  return normalizeConnections(await response.json());
}

export async function deleteConnectionWithRetry({
  id,
  token,
  fetchImpl = fetch,
  sleepImpl = sleep,
  baseUrl = getApiBase(),
  maxAttempts = 5,
  rateLimitDelayMs = 5_000,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetchImpl(`${baseUrl}/mcp/connections/${id}`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if ((response.status >= 200 && response.status < 300) || response.status === 404) {
      return { status: response.status, attempts: attempt };
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Authentication failed while deleting ${id} (${response.status}).`);
    }

    if (response.status === 429 && attempt < maxAttempts) {
      await sleepImpl(getRetryAfterMs(response.headers, rateLimitDelayMs));
      continue;
    }

    if ((response.status === 0 || response.status >= 500) && attempt < maxAttempts) {
      await sleepImpl(Math.min(rateLimitDelayMs, 1_000 * attempt));
      continue;
    }

    throw new Error(`Failed to delete ${id} (${response.status}): ${await response.text()}`);
  }

  throw new Error(`Failed to delete ${id}: retry limit exceeded.`);
}

export async function disconnectAllConnections({
  token,
  name = DEFAULT_CONNECTION_NAME,
  delayMs = DEFAULT_DELAY_MS,
  fetchImpl = fetch,
  sleepImpl = sleep,
  baseUrl = getApiBase(),
  onEvent = () => {},
} = {}) {
  if (!token) {
    throw new Error('No Poke auth token available.');
  }

  const connections = await fetchConnections({ token, fetchImpl, baseUrl });
  const matching = connections.filter((connection) => connection?.name === name);

  onEvent({ type: 'loaded', total: connections.length, matching: matching.length, name });

  let deleted = 0;
  for (const connection of matching) {
    const result = await deleteConnectionWithRetry({
      id: connection.id,
      token,
      fetchImpl,
      sleepImpl,
      baseUrl,
    });
    deleted++;
    onEvent({
      type: 'deleted',
      id: connection.id,
      deleted,
      total: matching.length,
      status: result.status,
      attempts: result.attempts,
    });
    if (deleted < matching.length && delayMs > 0) {
      await sleepImpl(delayMs);
    }
  }

  onEvent({ type: 'done', deleted, skipped: connections.length - matching.length, name });
  return { deleted, skipped: connections.length - matching.length, total: connections.length };
}

export async function disconnectAllCommand(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseDisconnectAllArgs(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error('Usage: poke-gate disconnect-all [--delay <ms>]');
    process.exitCode = 1;
    return null;
  }

  try {
    const token = await getPokeBrowserSessionToken({
      onEvent: (event) => {
        if (event.type === 'browser-opening') {
          log('Opening a temporary browser window for Poke authentication...');
        } else if (event.type === 'browser-waiting') {
          log('Waiting for Poke sign-in in the browser...');
        }
      },
    });

    const result = await disconnectAllConnections({
      token,
      ...options,
      name: DEFAULT_CONNECTION_NAME,
      onEvent: (event) => {
        if (event.type === 'loaded') {
          log(`Found ${event.matching} "${event.name}" connection(s) out of ${event.total}.`);
        } else if (event.type === 'deleted') {
          log(
            `Deleted ${event.deleted}/${event.total}: ${event.id} (${event.status}, ${event.attempts} attempt(s))`,
          );
        } else if (event.type === 'done') {
          log(
            `Done. Deleted ${event.deleted}; skipped ${event.skipped} non-${event.name} connection(s).`,
          );
        }
      },
    });

    return result;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return null;
  }
}
