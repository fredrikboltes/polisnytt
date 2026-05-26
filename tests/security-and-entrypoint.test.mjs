import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('index.html loads the Vite React entrypoint', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /<script\s+type="module"\s+src="\/index\.tsx"><\/script>/);
});

test('Gemini credentials and SDK are not exposed to browser inputs', async () => {
  const [clientService, viteConfig, html] = await Promise.all([
    readFile(new URL('../services/geminiService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(clientService, /@google\/genai/);
  assert.doesNotMatch(clientService, /process\.env/);
  assert.doesNotMatch(viteConfig, /process\.env\.(?:API_KEY|GEMINI_API_KEY)/);
  assert.doesNotMatch(html, /@google\/genai/);
  assert.match(clientService, /\/api\/generate-article/);
});
