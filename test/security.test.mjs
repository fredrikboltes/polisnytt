import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isPoliceEvent, parseEnvContent } from '../server.mjs';

test('Gemini API key stays out of the browser bundle path', async () => {
  const [viteConfig, clientGeminiService, indexHtml] = await Promise.all([
    readFile(new URL('../vite.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../services/geminiService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(viteConfig, /process\.env\.(API_KEY|GEMINI_API_KEY)/);
  assert.doesNotMatch(viteConfig, /GEMINI_API_KEY/);
  assert.doesNotMatch(clientGeminiService, /@google\/genai/);
  assert.doesNotMatch(clientGeminiService, /process\.env/);
  assert.match(clientGeminiService, /\/api\/generate-article/);
  assert.doesNotMatch(indexHtml, /@google\/genai/);
  assert.match(indexHtml, /<script\s+type="module"\s+src="\/index\.tsx"><\/script>/);
});

test('server accepts only complete police events for generation', () => {
  assert.equal(
    isPoliceEvent({
      id: 123,
      datetime: '2026-05-27 10:00:00',
      name: 'Trafikolycka',
      summary: 'En kort sammanfattning.',
      type: 'Trafikolycka',
      location: { name: 'Stockholm', gps: '59.3293,18.0686' },
    }),
    true,
  );

  assert.equal(
    isPoliceEvent({
      id: 123,
      datetime: '2026-05-27 10:00:00',
      name: 'Trafikolycka',
      summary: 'En kort sammanfattning.',
      type: 'Trafikolycka',
      location: null,
    }),
    false,
  );
});

test('local env parser handles quoted API keys', () => {
  assert.deepEqual(
    parseEnvContent(`
      # local development
      GEMINI_API_KEY="secret-key"
      API_KEY='legacy-key'
    `),
    {
      GEMINI_API_KEY: 'secret-key',
      API_KEY: 'legacy-key',
    },
  );
});
