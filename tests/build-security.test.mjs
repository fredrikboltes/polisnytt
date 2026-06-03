import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rootDir = path.resolve(import.meta.dirname, '..');
const distDir = path.join(rootDir, 'dist');
const sentinelKey = 'cursor-secret-sentinel-gemini-key';

test('production build includes the React entrypoint without leaking Gemini secrets', () => {
  execFileSync('npm', ['run', 'build'], {
    cwd: rootDir,
    env: {
      ...process.env,
      GEMINI_API_KEY: sentinelKey,
    },
    stdio: 'pipe',
  });

  const builtFiles = listFiles(distDir);
  const builtJavaScript = builtFiles.filter((filePath) => filePath.endsWith('.js'));

  assert.ok(builtJavaScript.length > 0, 'expected Vite to emit a bundled JavaScript entrypoint');

  for (const filePath of builtFiles) {
    const contents = readFileSync(filePath, 'utf8');
    assert.equal(contents.includes(sentinelKey), false, `${path.relative(rootDir, filePath)} leaked GEMINI_API_KEY`);
    assert.equal(contents.includes('@google/genai'), false, `${path.relative(rootDir, filePath)} bundled the Gemini SDK`);
  }
});

function listFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const filePath = path.join(directory, entry);
    return statSync(filePath).isDirectory() ? listFiles(filePath) : [filePath];
  });
}
