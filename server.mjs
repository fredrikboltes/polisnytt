import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');
const port = Number(process.env.PORT || 3000);
const maxJsonBytes = 128 * 1024;

await loadEnvFile('.env');
await loadEnvFile('.env.local');

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const articleSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    lead: { type: Type.STRING },
    body: { type: Type.STRING },
    category: { type: Type.STRING },
  },
  required: ['title', 'lead', 'body', 'category'],
};

let vite;
if (isDev) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({
    root: __dirname,
    server: { middlewareMode: true },
    appType: 'spa',
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/generate-article') {
      await handleGenerateArticle(req, res);
      return;
    }

    if (vite) {
      vite.middlewares(req, res, (error) => {
        if (error) {
          vite.ssrFixStacktrace(error);
          sendJson(res, 500, { error: 'Internal server error' });
          return;
        }
        sendNotFound(res);
      });
      return;
    }

    await serveStatic(url, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal server error' });
    }
  }
});

server.listen(port, '0.0.0.0', () => {
  const mode = isDev ? 'development' : 'production';
  console.log(`Polisnyheter server running in ${mode} mode on http://localhost:${port}`);
});

async function handleGenerateArticle(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
    return;
  }

  if (!ai) {
    sendJson(res, 500, { error: 'GEMINI_API_KEY is not configured' });
    return;
  }

  const event = await readJson(req);
  if (!isPoliceEvent(event)) {
    sendJson(res, 400, { error: 'Invalid police event payload' });
    return;
  }

  const prompt = `
    Förvandla följande polisrapport till en professionell, objektiv men engagerande nyhetsartikel på svenska.

    Händelseinfo:
    Titel: ${event.name}
    Sammanfattning: ${event.summary}
    Plats: ${event.location.name}
    Typ: ${event.type}
    Tid: ${event.datetime}

    Skapa en artikel som innehåller:
    1. En slagkraftig rubrik (title).
    2. En sammanfattande ingress (lead).
    3. En detaljerad brödtext (body).
    4. En passande kategori (category) t.ex. Blåljus, Brott, Trafikolycka.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: articleSchema,
    },
  });

  const result = JSON.parse(response.text || '{}');
  sendJson(res, 200, {
    id: `article-${event.id}-${Date.now()}`,
    originalEventId: event.id,
    title: result.title,
    lead: result.lead,
    body: result.body,
    category: result.category,
    location: event.location.name,
    timestamp: event.datetime,
    imageUrl: `https://picsum.photos/seed/${event.id}/800/450`,
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxJsonBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function isPoliceEvent(value) {
  return Boolean(
    value &&
    typeof value.id === 'number' &&
    typeof value.datetime === 'string' &&
    typeof value.name === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.type === 'string' &&
    value.location &&
    typeof value.location.name === 'string'
  );
}

async function serveStatic(url, res) {
  const distDir = path.join(__dirname, 'dist');
  const requestedPath = decodeURIComponent(url.pathname);
  let filePath = path.join(distDir, requestedPath === '/' ? 'index.html' : requestedPath);

  const relativePath = path.relative(distDir, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    filePath = path.join(distDir, 'index.html');
  }

  if (!existsSync(filePath)) {
    sendNotFound(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function sendNotFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
  }[ext] || 'application/octet-stream';
}

async function loadEnvFile(filename) {
  const filePath = path.join(__dirname, filename);
  if (!existsSync(filePath)) return;

  const contents = await readFile(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const [key, ...valueParts] = trimmed.split('=');
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = stripQuotes(valueParts.join('='));
  }
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
