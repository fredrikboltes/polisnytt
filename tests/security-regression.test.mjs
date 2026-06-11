import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readProjectFile = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

test('index.html loads the Vite React entrypoint', async () => {
  const html = await readProjectFile('index.html');

  assert.match(html, /<script\s+type="module"\s+src="\/index\.tsx"\s*><\/script>/);
});

test('Gemini API key and SDK stay out of browser-facing files', async () => {
  const [viteConfig, clientGeminiService] = await Promise.all([
    readProjectFile('vite.config.ts'),
    readProjectFile('services/geminiService.ts'),
  ]);

  assert.doesNotMatch(viteConfig, /GEMINI_API_KEY|process\.env\.API_KEY|process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(clientGeminiService, /@google\/genai|GoogleGenAI|process\.env|GEMINI_API_KEY|API_KEY/);
  assert.match(clientGeminiService, /\/api\/generate-article/);
});

test('server owns Gemini generation and environment access', async () => {
  const server = await readProjectFile('server.mjs');

  assert.match(server, /@google\/genai/);
  assert.match(server, /process\.env\.GEMINI_API_KEY/);
  assert.match(server, /\/api\/generate-article/);
});

test('production bundle does not contain Gemini secrets or SDK code', async () => {
  const distDir = path.join(root, 'dist');
  const files = await collectFiles(distDir);

  assert.ok(files.length > 0, 'dist must exist; run npm run build before npm test');

  const forbidden = /GEMINI_API_KEY|process\.env\.API_KEY|process\.env\.GEMINI_API_KEY|@google\/genai|GoogleGenAI/;
  for (const filePath of files) {
    const extension = path.extname(filePath);
    if (!['.html', '.js', '.css', '.json'].includes(extension)) {
      continue;
    }

    const contents = await readFile(filePath, 'utf8');
    assert.doesNotMatch(contents, forbidden, `${path.relative(root, filePath)} contains browser-side Gemini secret access`);
  }
});

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }

    return fullPath;
  }));

  return files.flat();
}
