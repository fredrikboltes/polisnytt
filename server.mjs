import http from 'node:http';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const distDir = path.join(root, 'dist');
const MAX_BODY_BYTES = 1024 * 1024;
const inheritedEnvKeys = new Set(Object.keys(process.env));

loadEnvFile(path.join(root, '.env'), inheritedEnvKeys);
loadEnvFile(path.join(root, '.env.local'), inheritedEnvKeys);

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

if (!ai) {
  console.warn('GEMINI_API_KEY is not configured. Article generation requests will fail.');
}

const vite = isProduction
  ? null
  : await createViteMiddleware();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/generate-article') {
      await handleGenerateArticle(req, res);
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (vite) {
      vite.middlewares(req, res, () => {
        sendText(res, 404, 'Not found');
      });
      return;
    }

    await serveStatic(url, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal server error' });
    } else {
      res.end();
    }
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});

async function createViteMiddleware() {
  const { createServer } = await import('vite');

  return createServer({
    root,
    server: { middlewareMode: true },
    appType: 'spa',
  });
}

async function handleGenerateArticle(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!ai) {
    sendJson(res, 503, { error: 'Article generation is not configured' });
    return;
  }

  const { event } = await readJsonBody(req);
  if (!isPoliceEvent(event)) {
    sendJson(res, 400, { error: 'Invalid police event' });
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
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          lead: { type: Type.STRING },
          body: { type: Type.STRING },
          category: { type: Type.STRING },
        },
        required: ['title', 'lead', 'body', 'category'],
      },
    },
  });

  const result = JSON.parse(response.text || '{}');

  if (!isGeneratedArticle(result)) {
    sendJson(res, 502, { error: 'Article generation returned an invalid response' });
    return;
  }

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

function loadEnvFile(filePath, protectedKeys) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');

    if (key && !protectedKeys.has(key)) {
      process.env[key] = value;
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;

    req.setEncoding('utf8');
    req.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      body += chunk;
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

async function serveStatic(url, res) {
  const requestedPath = decodeURIComponent(url.pathname);
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(distDir, safePath);

  if (!filePath.startsWith(distDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const stats = await fsPromises.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    filePath = path.join(distDir, 'index.html');
  }

  try {
    const content = await fsPromises.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
    });
    res.end(content);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

function isPoliceEvent(value) {
  return Boolean(
    value &&
      Number.isInteger(value.id) &&
      typeof value.datetime === 'string' &&
      typeof value.name === 'string' &&
      typeof value.summary === 'string' &&
      typeof value.type === 'string' &&
      value.location &&
      typeof value.location.name === 'string'
  );
}

function isGeneratedArticle(value) {
  return Boolean(
    value &&
      typeof value.title === 'string' &&
      typeof value.lead === 'string' &&
      typeof value.body === 'string' &&
      typeof value.category === 'string'
  );
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(text);
}

function getContentType(filePath) {
  const extension = path.extname(filePath);
  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
  };

  return contentTypes[extension] || 'application/octet-stream';
}
