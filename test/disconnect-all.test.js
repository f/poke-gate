import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteConnectionWithRetry,
  disconnectAllConnections,
  parseDisconnectAllArgs,
} from '../src/disconnect-all.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

test('disconnect-all defaults to poke-gate with 100ms delay', () => {
  assert.deepEqual(parseDisconnectAllArgs([]), { delayMs: 100 });
});

test('disconnect-all parses custom delay', () => {
  assert.deepEqual(parseDisconnectAllArgs(['--delay', '500']), {
    delayMs: 500,
  });
});

test('disconnect-all rejects custom names because the command only targets poke-gate', () => {
  assert.throws(
    () => parseDisconnectAllArgs(['--name', 'custom']),
    /Unknown disconnect-all option/,
  );
});

test('disconnectAllConnections deletes only poke-gate connections', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (!options.method) {
      return jsonResponse({
        connections: [
          { id: 'one', name: 'poke-gate' },
          { id: 'two', name: 'other' },
          { id: 'three', name: 'poke-gate' },
        ],
      });
    }
    return new Response('', { status: 200 });
  };

  const sleeps = [];
  const result = await disconnectAllConnections({
    token: 'token',
    fetchImpl,
    sleepImpl: async (ms) => sleeps.push(ms),
  });

  assert.deepEqual(result, { deleted: 2, skipped: 1, total: 3 });
  assert.deepEqual(
    calls.filter((call) => call.options.method === 'DELETE').map((call) => call.url),
    [
      'https://poke.com/api/v1/mcp/connections/one',
      'https://poke.com/api/v1/mcp/connections/three',
    ],
  );
  assert.deepEqual(sleeps, [100]);
});

test('deleteConnectionWithRetry backs off and retries on 429', async () => {
  const statuses = [429, 200];
  const sleeps = [];
  const result = await deleteConnectionWithRetry({
    id: 'one',
    token: 'token',
    fetchImpl: async () =>
      new Response('', {
        status: statuses.shift(),
        headers: { 'retry-after': '2' },
      }),
    sleepImpl: async (ms) => sleeps.push(ms),
  });

  assert.deepEqual(result, { status: 200, attempts: 2 });
  assert.deepEqual(sleeps, [2000]);
});

test('deleteConnectionWithRetry treats missing connections as deleted', async () => {
  const result = await deleteConnectionWithRetry({
    id: 'one',
    token: 'token',
    fetchImpl: async () => new Response('', { status: 404 }),
  });

  assert.deepEqual(result, { status: 404, attempts: 1 });
});
