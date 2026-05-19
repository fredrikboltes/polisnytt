import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

loadLocalEnv();

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
const vite = isProduction
  ? null
  : await import('vite').then(({ createServer }) =>
      createServer({
        server: { middlewareMode: true },
        appType: 'spa',
      })
    );

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/api/generate-article') {
      await handleGenerateArticle(req, res);
      return;
    }

    if (vite) {
      vite.middlewares(req, res);
      return;
    }

    await serveStaticFile(requestUrl.pathname, res);
  } catch (error) {
    console.error('Unhandled server error:', error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});

async function handleGenerateArticle(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!ai) {
    sendJson(res, 500, { error: 'Gemini API key is not configured' });
    return;
  }

  const body = await readJsonBody(req);
  const event = body?.event;

  if (!isPoliceEvent(event)) {
    sendJson(res, 400, { error: 'Invalid police event payload' });
    return;
  }

  const article = await generateNewsArticle(event);
  sendJson(res, 200, { article });
}

async function generateNewsArticle(event) {
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

  return {
    id: `article-${event.id}-${Date.now()}`,
    originalEventId: event.id,
    title: result.title,
    lead: result.lead,
    body: result.body,
    category: result.category,
    location: event.location.name,
    timestamp: event.datetime,
    imageUrl: `https://picsum.photos/seed/${event.id}/800/450`,
  };
}

async function readJsonBody(req) {
  let rawBody = '';

  for await (const chunk of req) {
    rawBody += chunk;
    if (rawBody.length > 1_000_000) {
      throw new Error('Request body too large');
    }
  }

  return rawBody ? JSON.parse(rawBody) : null;
}

function isPoliceEvent(event) {
  return (
    event &&
    Number.isInteger(event.id) &&
    typeof event.datetime === 'string' &&
    typeof event.name === 'string' &&
    typeof event.summary === 'string' &&
    typeof event.type === 'string' &&
    event.location &&
    typeof event.location.name === 'string'
  );
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return;

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function serveStaticFile(pathname, res) {
  const distDir = path.resolve(__dirname, 'dist');
  const decodedPath = decodeURIComponent(pathname);
  const safePath = path.resolve(distDir, `.${decodedPath}`);

  if (safePath !== distDir && !safePath.startsWith(`${distDir}${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const filePath = await resolveStaticPath(safePath, distDir);
  createReadStream(filePath)
    .on('error', () => {
      res.writeHead(500);
      res.end('Failed to read file');
    })
    .pipe(res.writeHead(200, { 'Content-Type': getContentType(filePath) }));
}

async function resolveStaticPath(safePath, distDir) {
  try {
    const fileStats = await stat(safePath);
    if (fileStats.isFile()) {
      return safePath;
    }
  } catch {
    // Fall through to the SPA entrypoint for client-side routes.
  }

  return path.join(distDir, 'index.html');
}

function getContentType(filePath) {
  const extension = path.extname(filePath);

  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function loadLocalEnv() {
  for (const filename of ['.env', '.env.local']) {
    const filePath = path.join(__dirname, filename);

    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, 'utf8');
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
      let value = trimmed.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}
