import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const readText = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('index.html includes the Vite React entrypoint', async () => {
  const html = await readText('index.html');

  assert.match(html, /<script\s+type="module"\s+src="\/index\.tsx"><\/script>/);
});

test('Gemini SDK and API keys stay out of browser-facing code', async () => {
  const [clientService, viteConfig, html] = await Promise.all([
    readText('services/geminiService.ts'),
    readText('vite.config.ts'),
    readText('index.html'),
  ]);

  assert.doesNotMatch(clientService, /@google\/genai|process\.env|GEMINI_API_KEY|API_KEY/);
  assert.match(clientService, /fetch\("\/api\/generate-article"/);
  assert.doesNotMatch(viteConfig, /loadEnv|process\.env|GEMINI_API_KEY|API_KEY/);
  assert.doesNotMatch(html, /@google\/genai|GEMINI_API_KEY|API_KEY/);
});
