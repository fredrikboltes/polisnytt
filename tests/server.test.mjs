import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildArticlePrompt, isPoliceEvent, loadEnvFiles } from '../server.mjs';

const sampleEvent = {
  id: 123,
  datetime: '2026-06-09 10:30',
  name: 'Brand, Stockholm',
  summary: 'Larm om rökutveckling i flerfamiljshus.',
  url: 'https://polisen.se/aktuellt/handelser/',
  type: 'Brand',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

test('validates police event payloads before server-side generation', () => {
  assert.equal(isPoliceEvent(sampleEvent), true);
  assert.equal(isPoliceEvent({ ...sampleEvent, id: '123' }), false);
  assert.equal(isPoliceEvent({ ...sampleEvent, location: null }), false);
});

test('builds an article prompt from the police event details', () => {
  const prompt = buildArticlePrompt(sampleEvent);

  assert.match(prompt, /Brand, Stockholm/);
  assert.match(prompt, /Larm om rökutveckling/);
  assert.match(prompt, /Stockholm/);
  assert.match(prompt, /2026-06-09 10:30/);
});

test('loads local env files without overriding real environment variables', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'polisnytt-env-'));
  const existingKey = `POLISNYTT_EXISTING_${Date.now()}`;
  const localKey = `POLISNYTT_LOCAL_${Date.now()}`;

  process.env[existingKey] = 'from-process';

  try {
    await writeFile(path.join(directory, '.env'), `${existingKey}=from-env\n${localKey}=from-env\n`);
    await writeFile(path.join(directory, '.env.local'), `${existingKey}=from-local\n${localKey}=from-local\n`);

    loadEnvFiles(directory);

    assert.equal(process.env[existingKey], 'from-process');
    assert.equal(process.env[localKey], 'from-local');
  } finally {
    delete process.env[existingKey];
    delete process.env[localKey];
    await rm(directory, { recursive: true, force: true });
  }
});

test('client article generation uses the local API instead of bundling Gemini', async () => {
  const clientSource = await readFile(new URL('../services/geminiService.ts', import.meta.url), 'utf8');
  const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

  assert.match(clientSource, /\/api\/generate-article/);
  assert.doesNotMatch(clientSource, /@google\/genai|process\.env|GEMINI_API_KEY|API_KEY/);
  assert.doesNotMatch(viteConfig, /GEMINI_API_KEY|process\.env|API_KEY/);
});
