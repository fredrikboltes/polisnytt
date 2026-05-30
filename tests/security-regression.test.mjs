import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = filePath => readFile(new URL(`../${filePath}`, import.meta.url), 'utf8');

test('React entrypoint is loaded by Vite HTML', async () => {
  const html = await readSource('index.html');

  assert.match(html, /<script\s+type="module"\s+src="\/index\.tsx"><\/script>/);
});

test('Gemini credentials and SDK stay out of the browser bundle path', async () => {
  const [clientService, viteConfig, html] = await Promise.all([
    readSource('services/geminiService.ts'),
    readSource('vite.config.ts'),
    readSource('index.html'),
  ]);

  assert.doesNotMatch(clientService, /@google\/genai/);
  assert.doesNotMatch(clientService, /process\.env/);
  assert.doesNotMatch(viteConfig, /process\.env\.(?:API_KEY|GEMINI_API_KEY)/);
  assert.doesNotMatch(html, /@google\/genai/);
});

test('Gemini generation is handled by the local server API', async () => {
  const [clientService, server] = await Promise.all([
    readSource('services/geminiService.ts'),
    readSource('server.mjs'),
  ]);

  assert.match(clientService, /\/api\/generate-article/);
  assert.match(server, /@google\/genai/);
  assert.match(server, /GEMINI_API_KEY/);
});
