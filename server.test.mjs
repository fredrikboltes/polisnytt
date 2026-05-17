import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildNewsArticle, getGeminiApiKey, loadLocalEnv } from './server.mjs';

const event = {
  id: 123,
  datetime: '2026-05-17 10:15',
  name: '17 maj 10.15, Trafikolycka, Stockholm',
  summary: 'Två bilar har kolliderat på E4.',
  url: 'https://polisen.se/aktuellt/handelser/123',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

test('buildNewsArticle maps Gemini output without client-side secrets', () => {
  const article = buildNewsArticle(event, {
    title: 'Kollision på E4 i Stockholm',
    lead: 'Två bilar var inblandade i en trafikolycka.',
    body: 'Polisen uppger att olyckan inträffade på E4 under förmiddagen.',
    category: 'Trafikolycka',
  }, 42);

  assert.deepEqual(article, {
    id: 'article-123-42',
    originalEventId: 123,
    title: 'Kollision på E4 i Stockholm',
    lead: 'Två bilar var inblandade i en trafikolycka.',
    body: 'Polisen uppger att olyckan inträffade på E4 under förmiddagen.',
    category: 'Trafikolycka',
    location: 'Stockholm',
    timestamp: '2026-05-17 10:15',
    imageUrl: 'https://picsum.photos/seed/123/800/450',
  });
});

test('getGeminiApiKey reads server environment without requiring Vite defines', () => {
  assert.equal(getGeminiApiKey({ GEMINI_API_KEY: 'primary', API_KEY: 'fallback' }), 'primary');
  assert.equal(getGeminiApiKey({ API_KEY: 'fallback' }), 'fallback');
  assert.equal(getGeminiApiKey({}), '');
});

test('loadLocalEnv reads .env.local without overriding process-provided values', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'polisnytt-env-'));
  try {
    await writeFile(path.join(rootDir, '.env'), 'GEMINI_API_KEY=from-env\nAPI_KEY=from-env\n');
    await writeFile(path.join(rootDir, '.env.local'), 'GEMINI_API_KEY="from-local"\nAPI_KEY=from-local\n');

    const env = { API_KEY: 'from-process' };
    await loadLocalEnv({ rootDir, env });

    assert.equal(env.GEMINI_API_KEY, 'from-local');
    assert.equal(env.API_KEY, 'from-process');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
