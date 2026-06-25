import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_FRONTEND = 'https://poke.com';
const SESSION_COOKIE_PATTERN = /^INTERACTION_.*_SESSION_TOKEN$/;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFrontend(env = process.env) {
  return env.POKE_FRONTEND ?? DEFAULT_FRONTEND;
}

function pathExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function which(command) {
  try {
    return execFileSync('which', [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function findChromiumBrowser(env = process.env) {
  if (env.POKE_GATE_CHROME && pathExists(env.POKE_GATE_CHROME)) {
    return env.POKE_GATE_CHROME;
  }

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    which('google-chrome-stable'),
    which('google-chrome'),
    which('chromium'),
    which('chromium-browser'),
    which('microsoft-edge'),
    which('brave-browser'),
  ].filter(Boolean);

  return candidates.find(pathExists) ?? null;
}

export function findPokeSessionToken(cookies, frontendHost = 'poke.com') {
  const pokeCookies = cookies.filter((cookie) => {
    const domain = cookie.domain?.replace(/^\./, '') ?? '';
    return domain === frontendHost || domain.endsWith(`.${frontendHost}`);
  });

  const cookie =
    pokeCookies.find((candidate) => candidate.name === 'INTERACTION_production_SESSION_TOKEN') ??
    pokeCookies.find((candidate) => SESSION_COOKIE_PATTERN.test(candidate.name));

  return cookie?.value ?? null;
}

export function findJwtTokenInText(text) {
  if (typeof text !== 'string') return null;
  const matches = text.match(JWT_PATTERN);
  return matches?.[0] ?? null;
}

export function findPokeSessionTokenInBrowserValues(values, frontendHost = 'poke.com') {
  for (const entry of values) {
    if (entry?.key && SESSION_COOKIE_PATTERN.test(entry.key) && entry.value) {
      return entry.value;
    }

    const jwt = findJwtTokenInText(entry?.value);
    if (jwt) return jwt;
  }

  const documentCookieEntry = values.find((entry) => entry?.key === 'document.cookie');
  if (documentCookieEntry?.value) {
    const cookies = documentCookieEntry.value.split(/;\s*/).map((pair) => {
      const separator = pair.indexOf('=');
      return {
        name: separator === -1 ? pair : pair.slice(0, separator),
        value: separator === -1 ? '' : pair.slice(separator + 1),
        domain: frontendHost,
      };
    });
    return findPokeSessionToken(cookies, frontendHost);
  }

  return null;
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return port;
}

async function waitForDevTools(port, { fetchImpl, sleepImpl, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
      lastError = new Error(`Chrome DevTools returned ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await sleepImpl(250);
  }

  throw new Error(
    `Timed out waiting for Chrome DevTools: ${lastError?.message ?? 'unknown error'}`,
  );
}

async function openPageTarget(port, url, { fetchImpl }) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });

  if (response.ok) {
    const target = await response.json();
    if (target.webSocketDebuggerUrl) return target;
  }

  const listResponse = await fetchImpl(`http://127.0.0.1:${port}/json/list`);
  if (!listResponse.ok) {
    throw new Error(`Failed to list Chrome pages (${listResponse.status}).`);
  }

  const targets = await listResponse.json();
  const target = targets.find(
    (candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl,
  );
  if (!target) {
    throw new Error('Chrome did not expose a debuggable page.');
  }
  return target;
}

async function listPageTargets(port, { fetchImpl }) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`Failed to list Chrome pages (${response.status}).`);
  }

  const targets = await response.json();
  return targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
}

async function readTokenFromTarget(target, { frontend, frontendHost }) {
  const connection = await DevToolsConnection.connect(target.webSocketDebuggerUrl);
  try {
    await connection.command('Network.enable').catch(() => {});

    for (const command of [
      () => connection.command('Storage.getCookies'),
      () => connection.command('Network.getAllCookies'),
      () => connection.command('Network.getCookies', { urls: [frontend] }),
    ]) {
      const result = await command().catch(() => null);
      const token = findPokeSessionToken(result?.cookies ?? [], frontendHost);
      if (token) return token;
    }

    const result = await connection
      .command('Runtime.evaluate', {
        expression: `(() => {
          const values = [];
          const push = (storageName, key, value) => {
            if (typeof value === 'string') values.push({ storage: storageName, key, value });
          };
          for (const [storageName, storage] of [['localStorage', globalThis.localStorage], ['sessionStorage', globalThis.sessionStorage]]) {
            try {
              for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                push(storageName, key, storage.getItem(key));
              }
            } catch {}
          }
          try { push('cookie', 'document.cookie', document.cookie); } catch {}
          return values;
        })()`,
        returnByValue: true,
      })
      .catch(() => null);

    return findPokeSessionTokenInBrowserValues(result?.result?.value ?? [], frontendHost);
  } finally {
    connection.close();
  }
}

class DevToolsConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => this.handleData(chunk));
    socket.on('error', (err) => this.rejectAll(err));
    socket.on('close', () => this.rejectAll(new Error('Chrome DevTools connection closed.')));
  }

  static async connect(webSocketDebuggerUrl) {
    const url = new URL(webSocketDebuggerUrl);
    if (url.protocol !== 'ws:') {
      throw new Error(`Unsupported Chrome DevTools protocol: ${url.protocol}`);
    }

    const socket = await new Promise((resolve, reject) => {
      const client = net.connect(Number(url.port), url.hostname, () => resolve(client));
      client.once('error', reject);
    });

    const key = randomBytes(16).toString('base64');
    const request = [
      `GET ${url.pathname}${url.search} HTTP/1.1`,
      `Host: ${url.host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n');
    socket.write(request);

    await readHandshake(socket, key);
    return new DevToolsConnection(socket);
  }

  command(method, params = {}) {
    const id = this.nextId++;
    this.writeFrame(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    if (!this.socket.destroyed) {
      this.writeFrame('', 0x8);
      this.socket.end();
    }
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const frame = readFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.bytesRead);

      if (frame.opcode === 0x8) {
        this.socket.end();
        return;
      }
      if (frame.opcode === 0x9) {
        this.writeFrame(frame.payload, 0xa);
        continue;
      }
      if (frame.opcode !== 0x1) continue;

      const message = JSON.parse(frame.payload.toString('utf8'));
      if (!message.id) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  rejectAll(err) {
    for (const { reject } of this.pending.values()) {
      reject(err);
    }
    this.pending.clear();
  }

  writeFrame(payload, opcode = 0x1) {
    const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const length = payloadBuffer.length;
    const lengthBytes = length < 126 ? 0 : length <= 0xffff ? 2 : 8;
    const header = Buffer.alloc(2 + lengthBytes + 4);

    header[0] = 0x80 | opcode;
    if (length < 126) {
      header[1] = 0x80 | length;
    } else if (length <= 0xffff) {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    const maskOffset = 2 + lengthBytes;
    const mask = randomBytes(4);
    mask.copy(header, maskOffset);

    const masked = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
      masked[i] = payloadBuffer[i] ^ mask[i % 4];
    }

    this.socket.write(Buffer.concat([header, masked]));
  }
}

function readFrame(buffer) {
  const secondByte = buffer[1];
  let length = secondByte & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  const masked = (secondByte & 0x80) !== 0;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  return {
    opcode: buffer[0] & 0x0f,
    payload,
    bytesRead: offset + length,
  };
}

async function readHandshake(socket, key) {
  const expectedAccept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  const response = await new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out connecting to Chrome DevTools.'));
    }, 5_000);

    function cleanup() {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      cleanup();
      resolve(buffer.subarray(0, headerEnd).toString('utf8'));
    }

    socket.on('data', onData);
    socket.once('error', onError);
  });

  if (!response.startsWith('HTTP/1.1 101')) {
    throw new Error(`Chrome DevTools WebSocket handshake failed: ${response.split('\r\n')[0]}`);
  }

  const acceptHeader = response
    .split('\r\n')
    .find((line) => line.toLowerCase().startsWith('sec-websocket-accept:'))
    ?.split(':')
    .slice(1)
    .join(':')
    .trim();
  if (acceptHeader !== expectedAccept) {
    throw new Error('Chrome DevTools WebSocket handshake returned an invalid accept header.');
  }
}

export async function getPokeBrowserSessionToken({
  env = process.env,
  fetchImpl = fetch,
  sleepImpl = sleep,
  timeoutMs = 5 * 60_000,
  onEvent = () => {},
} = {}) {
  if (env.POKE_SESSION_TOKEN) return env.POKE_SESSION_TOKEN;

  const browserPath = findChromiumBrowser(env);
  if (!browserPath) {
    throw new Error(
      'No Chromium browser found. Install Google Chrome, or set POKE_GATE_CHROME to a Chromium executable.',
    );
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poke-gate-auth-'));
  const frontend = getFrontend(env);
  const authUrl = `${frontend}/settings/advanced`;

  onEvent({ type: 'browser-opening', browserPath, authUrl });
  const browser = spawn(
    browserPath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      authUrl,
    ],
    { stdio: 'ignore' },
  );

  browser.on('error', () => {});

  try {
    await waitForDevTools(port, { fetchImpl, sleepImpl, timeoutMs: 15_000 });
    await openPageTarget(port, authUrl, { fetchImpl });
    onEvent({ type: 'browser-waiting' });

    const frontendHost = new URL(frontend).hostname;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const targets = await listPageTargets(port, { fetchImpl });
      for (const target of targets) {
        const token = await readTokenFromTarget(target, { frontend, frontendHost }).catch(
          () => null,
        );
        if (token) return token;
      }
      await sleepImpl(1_000);
    }

    throw new Error('Timed out waiting for Poke browser sign-in.');
  } finally {
    if (!browser.killed) {
      browser.kill('SIGTERM');
    }
    setTimeout(() => fs.rmSync(userDataDir, { recursive: true, force: true }), 1_000).unref();
  }
}
