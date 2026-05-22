import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const distDir = path.join(rootDir, 'dist');
const forbiddenPatterns = [
  /AIzaTEST_SECRET/,
  /GEMINI_API_KEY/,
  /process\.env/,
  /@google\/genai/,
  /GoogleGenAI/,
];

const readDistFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? readDistFiles(entryPath) : [entryPath];
  }));

  return files.flat();
};

const indexHtml = await readFile(path.join(distDir, 'index.html'), 'utf8');
if (!/<script[^>]+type="module"[^>]+src="\/assets\//.test(indexHtml)) {
  throw new Error('Build output is missing the bundled Vite application entrypoint');
}

for (const filePath of await readDistFiles(distDir)) {
  const contents = await readFile(filePath, 'utf8');
  const relativePath = path.relative(rootDir, filePath);

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(contents)) {
      throw new Error(`Forbidden browser bundle content matched ${pattern} in ${relativePath}`);
    }
  }
}

console.log('Build output contains the app entrypoint and no Gemini server secrets/client SDK.');
