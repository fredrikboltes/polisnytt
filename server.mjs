import { createReadStream, existsSync } from 'node:fs';
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArticleApiHandler } from './server/articleApi.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const distDir = path.join(rootDir, 'dist');
const mode = process.env.NODE_ENV || 'production';
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

loadEnvFiles(rootDir, mode);

const handleArticleApi = createArticleApiHandler({
  apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY,
});

createServer(async (req, res) => {
  if (req.url?.startsWith('/api/generate-article')) {
    await handleArticleApi(req, res);
    return;
  }

  serveStaticAsset(req, res);
}).listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});

function serveStaticAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  if (!existsSync(distDir)) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Build output not found. Run `npm run build` before starting the production server.');
    return;
  }

  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(requestUrl.pathname);
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = safeJoin(distDir, requestedPath);

  if (!filePath) {
    res.writeHead(403);
    res.end();
    return;
  }

  let assetPath = filePath;
  if (!existsSync(assetPath) || statSync(assetPath).isDirectory()) {
    assetPath = path.join(distDir, 'index.html');
  }

  const stream = createReadStream(assetPath);
  res.writeHead(200, { 'Content-Type': contentTypeFor(assetPath) });
  if (req.method === 'HEAD') {
    res.end();
    stream.destroy();
    return;
  }
  stream.pipe(res);
}

function safeJoin(baseDir, requestPath) {
  const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const joinedPath = path.join(baseDir, normalizedPath);
  const relativePath = path.relative(baseDir, joinedPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return joinedPath;
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath);
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
  }[extension] || 'application/octet-stream';
}

function loadEnvFiles(directory, currentMode) {
  const protectedKeys = new Set(Object.keys(process.env));
  const files = ['.env', '.env.local', `.env.${currentMode}`, `.env.${currentMode}.local`];

  for (const file of files) {
    const filePath = path.join(directory, file);
    if (!existsSync(filePath)) {
      continue;
    }

    const variables = parseEnv(readFileSync(filePath, 'utf8'));
    for (const [key, value] of Object.entries(variables)) {
      if (!protectedKeys.has(key)) {
        process.env[key] = value;
      }
    }
  }
}

function parseEnv(contents) {
  const values = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}
