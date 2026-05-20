import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('index.html loads the Vite application entrypoint', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /<script\s+type="module"\s+src="\/index\.tsx"><\/script>/);
});

test('production bundle does not include Gemini server-only code or env shims', () => {
  const dist = path.join(root, 'dist');
  const files = listFiles(dist).filter((file) => /\.(html|js|css)$/.test(file));
  const bundle = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

  assert.doesNotMatch(bundle, /@google\/genai/);
  assert.doesNotMatch(bundle, /GEMINI_API_KEY|process\.env\.API_KEY|process\.env\.GEMINI_API_KEY/);
});

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}
