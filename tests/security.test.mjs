import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('browser code does not import Gemini SDK or read server secrets', async () => {
  const browserFiles = [
    'App.tsx',
    'index.tsx',
    'index.html',
    'services/geminiService.ts',
    'services/policeService.ts',
    'components/ArticleCard.tsx',
    'components/CountySelector.tsx',
    'components/Header.tsx',
  ];

  for (const file of browserFiles) {
    const contents = await readProjectFile(file);
    assert.doesNotMatch(contents, /@google\/genai/, `${file} must not import Gemini in browser code`);
    assert.doesNotMatch(contents, /process\.env\.(?:API_KEY|GEMINI_API_KEY)/, `${file} must not read API keys`);
  }
});

test('Vite config does not inline Gemini secrets into the client bundle', async () => {
  const viteConfig = await readProjectFile('vite.config.ts');

  assert.doesNotMatch(viteConfig, /GEMINI_API_KEY/);
  assert.doesNotMatch(viteConfig, /process\.env\.API_KEY/);
  assert.doesNotMatch(viteConfig, /\bdefine\s*:/);
});

test('HTML loads the Vite React entrypoint', async () => {
  const html = await readProjectFile('index.html');

  assert.match(html, /<script\s+type="module"\s+src="\/index\.tsx"><\/script>/);
});
