import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve('dist');
const forbiddenPatterns = [
  'GEMINI_API_KEY',
  'process.env.API_KEY',
  'process.env.GEMINI_API_KEY',
  '@google/genai',
  'GoogleGenAI',
];

if (process.env.GEMINI_API_KEY) {
  forbiddenPatterns.push(process.env.GEMINI_API_KEY);
}

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(filePath)));
    } else {
      files.push(filePath);
    }
  }

  return files;
};

const files = await collectFiles(distDir);
const violations = [];

for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (content.includes(pattern)) {
      violations.push(`${path.relative(process.cwd(), file)} contains ${pattern}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Client bundle contains server-only Gemini material:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Client bundle does not contain Gemini secrets or server SDK imports.');
