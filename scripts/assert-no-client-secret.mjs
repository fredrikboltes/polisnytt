import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve('dist');
const secretValues = [process.env.GEMINI_API_KEY, process.env.API_KEY]
  .filter((value) => typeof value === 'string' && value.length > 0);
const forbiddenPatterns = [
  'GEMINI_API_KEY',
  'process.env.API_KEY',
  'process.env.GEMINI_API_KEY',
  '@google/genai',
  ...secretValues,
];

const findings = [];

for (const filePath of await listFiles(distDir)) {
  const contents = await readFile(filePath, 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (contents.includes(pattern)) {
      findings.push(`${path.relative(distDir, filePath)} contains ${pattern}`);
    }
  }
}

if (findings.length > 0) {
  console.error('Client build contains server-only Gemini material:');
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log('No Gemini API key material found in the client build.');

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}
