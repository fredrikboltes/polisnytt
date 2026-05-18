import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('client Gemini service calls the server endpoint without bundling the SDK', async () => {
  const service = await readWorkspaceFile('services/geminiService.ts');

  assert.match(service, /fetch\(["']\/api\/generate-article["']/);
  assert.doesNotMatch(service, /@google\/genai/);
  assert.doesNotMatch(service, /process\.env/);
});

test('Vite config does not expose Gemini secrets to the browser bundle', async () => {
  const config = await readWorkspaceFile('vite.config.ts');

  assert.doesNotMatch(config, /process\.env\.API_KEY/);
  assert.doesNotMatch(config, /process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(config, /GEMINI_API_KEY/);
});

test('HTML includes the Vite React entrypoint', async () => {
  const html = await readWorkspaceFile('index.html');

  assert.match(html, /<script\s+type=["']module["']\s+src=["']\/index\.tsx["']><\/script>/);
});

test('development script starts the API server', async () => {
  const pkg = JSON.parse(await readWorkspaceFile('package.json'));

  assert.equal(pkg.scripts.dev, 'node server.mjs');
});

function readWorkspaceFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}
