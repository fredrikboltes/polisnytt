import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('index.html includes the Vite React entrypoint', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /<script\s+type="module"\s+src="\/index\.tsx"><\/script>/);
});

test('Vite config does not inline Gemini secrets into the browser bundle', async () => {
  const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(config, /process\.env\.(?:API_KEY|GEMINI_API_KEY)/);
  assert.doesNotMatch(config, /GEMINI_API_KEY/);
});

test('client Gemini service calls the server API instead of the Gemini SDK', async () => {
  const service = await readFile(new URL('../services/geminiService.ts', import.meta.url), 'utf8');

  assert.match(service, /fetch\(['"]\/api\/generate-article['"]/);
  assert.doesNotMatch(service, /@google\/genai/);
  assert.doesNotMatch(service, /process\.env/);
});
