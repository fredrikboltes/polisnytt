import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('index.html loads the Vite React entrypoint', async () => {
  const html = await readProjectFile('index.html');

  assert.match(html, /<script\s+type="module"\s+src="\/index\.tsx"><\/script>/);
  assert.doesNotMatch(html, /<script\s+type="importmap">/);
});

test('Gemini generation stays behind the server API', async () => {
  const clientService = await readProjectFile('services/geminiService.ts');
  const viteConfig = await readProjectFile('vite.config.ts');
  const server = await readProjectFile('server.mjs');

  assert.match(clientService, /fetch\('\/api\/generate-article'/);
  assert.doesNotMatch(clientService, /@google\/genai/);
  assert.doesNotMatch(clientService, /process\.env/);

  assert.doesNotMatch(viteConfig, /GEMINI_API_KEY|API_KEY|process\.env/);

  assert.match(server, /from '@google\/genai'/);
  assert.match(server, /process\.env\.GEMINI_API_KEY/);
});
