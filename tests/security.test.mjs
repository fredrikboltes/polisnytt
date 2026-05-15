import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const readSource = (filePath) => readFile(path.join(repoRoot, filePath), 'utf8');

test('client does not import Gemini SDK or read server environment secrets', async () => {
  const clientSource = await readSource('services/geminiService.ts');

  assert.equal(clientSource.includes('@google/genai'), false);
  assert.equal(clientSource.includes('process.env'), false);
  assert.match(clientSource, /\/api\/generate-article/);
});

test('vite config does not inject Gemini secrets into the browser bundle', async () => {
  const viteConfig = await readSource('vite.config.ts');

  assert.equal(viteConfig.includes('GEMINI_API_KEY'), false);
  assert.equal(viteConfig.includes('process.env.API_KEY'), false);
});

test('html entrypoint loads the React application bundle', async () => {
  const indexHtml = await readSource('index.html');

  assert.match(indexHtml, /<script\s+type="module"\s+src="\/index\.tsx"><\/script>/);
});
