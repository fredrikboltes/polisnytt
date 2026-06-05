import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve('dist');
const forbiddenValues = [
  '@google/genai',
  'process.env.API_KEY',
  'process.env.GEMINI_API_KEY',
  'GEMINI_API_KEY',
  'API_KEY',
  process.env.GEMINI_API_KEY,
  process.env.API_KEY,
].filter(Boolean);

const files = await collectFiles(distDir);
const failures = [];

for (const file of files) {
  const contents = await readFile(file, 'utf8');
  for (const value of forbiddenValues) {
    if (contents.includes(value)) {
      failures.push(`${path.relative(process.cwd(), file)} contains forbidden value "${value}"`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Checked ${files.length} built files; no Gemini secrets or client SDK references found.`);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  }));

  return nested.flat();
}
