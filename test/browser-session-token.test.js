import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findJwtTokenInText,
  findPokeSessionToken,
  findPokeSessionTokenInBrowserValues,
} from '../src/browser-session-token.js';

test('findPokeSessionToken prefers the production Poke cookie', () => {
  assert.equal(
    findPokeSessionToken([
      { name: 'INTERACTION_preview_SESSION_TOKEN', value: 'preview', domain: '.poke.com' },
      { name: 'INTERACTION_production_SESSION_TOKEN', value: 'production', domain: '.poke.com' },
    ]),
    'production',
  );
});

test('findPokeSessionToken falls back to any Poke session cookie', () => {
  assert.equal(
    findPokeSessionToken([
      { name: 'other', value: 'nope', domain: '.poke.com' },
      { name: 'INTERACTION_staging_SESSION_TOKEN', value: 'staging', domain: 'poke.com' },
    ]),
    'staging',
  );
});

test('findPokeSessionToken ignores unrelated domains', () => {
  assert.equal(
    findPokeSessionToken([
      { name: 'INTERACTION_production_SESSION_TOKEN', value: 'other', domain: '.example.com' },
    ]),
    null,
  );
});

test('findPokeSessionToken supports custom frontend hosts', () => {
  assert.equal(
    findPokeSessionToken(
      [{ name: 'INTERACTION_production_SESSION_TOKEN', value: 'custom', domain: '.preview.test' }],
      'preview.test',
    ),
    'custom',
  );
});

test('findJwtTokenInText extracts bearer-shaped JWT values', () => {
  assert.equal(
    findJwtTokenInText(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_123',
    ),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_123',
  );
});

test('findPokeSessionTokenInBrowserValues reads storage entries', () => {
  assert.equal(
    findPokeSessionTokenInBrowserValues([
      {
        storage: 'localStorage',
        key: 'auth',
        value: '{"token":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_123"}',
      },
    ]),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_123',
  );
});

test('findPokeSessionTokenInBrowserValues reads document.cookie values', () => {
  assert.equal(
    findPokeSessionTokenInBrowserValues([
      {
        storage: 'cookie',
        key: 'document.cookie',
        value: 'other=1; INTERACTION_production_SESSION_TOKEN=session-token',
      },
    ]),
    'session-token',
  );
});
