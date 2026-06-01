import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'dist-test');
const sentinelKey = 'SENTINEL_GEMINI_KEY_SHOULD_NOT_BE_IN_CLIENT';

const readText = (relativePath) => readFileSync(path.join(rootDir, relativePath), 'utf8');

const collectFiles = (dir) => {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
};

assert.match(
  readText('index.html'),
  /<script\s+type="module"\s+src="\/index\.tsx"><\/script>/,
  'index.html must load the React entrypoint so Vite bundles the app',
);

assert.doesNotMatch(
  readText('vite.config.ts'),
  /GEMINI_API_KEY|process\.env\.API_KEY|process\.env\.GEMINI_API_KEY/,
  'Vite config must not inline Gemini secrets into the browser bundle',
);

assert.doesNotMatch(
  readText('services/geminiService.ts'),
  /@google\/genai|process\.env/,
  'The browser Gemini service must call the server endpoint instead of using secrets directly',
);

rmSync(outDir, { recursive: true, force: true });

try {
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'build', '--outDir', outDir, '--emptyOutDir'],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        GEMINI_API_KEY: sentinelKey,
      },
      stdio: 'inherit',
    },
  );

  const builtIndex = readFileSync(path.join(outDir, 'index.html'), 'utf8');
  assert.match(
    builtIndex,
    /<script type="module" crossorigin src="\/assets\/[^"]+\.js"><\/script>/,
    'Built index.html must reference the bundled React app',
  );

  const files = collectFiles(outDir).filter((filePath) => /\.(html|js|css|json)$/.test(filePath));
  assert.ok(files.length > 0, 'Build should emit client assets to scan');

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf8');
    assert.equal(
      content.includes(sentinelKey),
      false,
      `Client bundle leaked the Gemini API key in ${path.relative(rootDir, filePath)}`,
    );
    assert.equal(
      content.includes('@google/genai'),
      false,
      `Client bundle includes the Gemini SDK in ${path.relative(rootDir, filePath)}`,
    );
  }
} finally {
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }
}
