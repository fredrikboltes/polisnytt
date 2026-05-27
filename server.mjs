import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, 'dist');
const MAX_JSON_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

export function parseEnvContent(content) {
  const values = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }

    values[match[1]] = value;
  }

  return values;
}

export function loadLocalEnv(baseDir = __dirname) {
  const loaded = {};

  for (const filename of ['.env', '.env.local']) {
    const envPath = path.join(baseDir, filename);
    if (!existsSync(envPath)) {
      continue;
    }

    Object.assign(loaded, parseEnvContent(readFileSync(envPath, 'utf8')));
  }

  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function isPoliceEvent(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.id === 'number' &&
      typeof value.datetime === 'string' &&
      typeof value.name === 'string' &&
      typeof value.summary === 'string' &&
      typeof value.type === 'string' &&
      value.location &&
      typeof value.location === 'object' &&
      typeof value.location.name === 'string',
  );
}

export async function generateNewsArticle(event, apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const ai = new GoogleGenAI({ apiKey });
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
  assertArticleResult(result);

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

export async function createRequestListener({ rootDir = __dirname, production = process.env.NODE_ENV === 'production' } = {}) {
  const vite = production
    ? null
    : await createViteMiddleware(rootDir);

  return async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

      if (requestUrl.pathname === '/api/generate-article') {
        await handleGenerateArticleRequest(request, response);
        return;
      }

      if (vite) {
        vite.middlewares(request, response, () => sendNotFound(response));
        return;
      }

      await serveStaticFile(request, response);
    } catch (error) {
      console.error('Unhandled server error:', error);
      sendJson(response, 500, { error: 'Internal server error' });
    }
  };
}

export async function startServer({ port = Number(process.env.PORT || 3000), rootDir = __dirname } = {}) {
  loadLocalEnv(rootDir);

  const listener = await createRequestListener({ rootDir });
  const server = createServer(listener);

  await new Promise((resolve) => {
    server.listen(port, '0.0.0.0', resolve);
  });

  console.log(`Server listening on http://0.0.0.0:${port}`);
  return server;
}

async function createViteMiddleware(rootDir) {
  const { createServer: createViteServer } = await import('vite');

  return createViteServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: 'spa',
  });
}

async function handleGenerateArticleRequest(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const payload = await readJsonBody(request);
  if (!isPoliceEvent(payload?.event)) {
    sendJson(response, 400, { error: 'Invalid police event' });
    return;
  }

  try {
    const article = await generateNewsArticle(payload.event);
    sendJson(response, 200, article);
  } catch (error) {
    console.error('Error generating news article with Gemini:', error);
    sendJson(response, 502, { error: 'Failed to generate article' });
  }
}

async function readJsonBody(request) {
  let body = '';
  let receivedBytes = 0;

  for await (const chunk of request) {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_JSON_BODY_BYTES) {
      throw new Error('Request body is too large');
    }
    body += chunk;
  }

  return JSON.parse(body || '{}');
}

async function serveStaticFile(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    sendText(response, 405, 'Method not allowed');
    return;
  }

  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    sendText(response, 400, 'Bad request');
    return;
  }

  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  const targetPath = await getExistingFilePath(filePath, pathname);
  if (!targetPath) {
    sendNotFound(response);
    return;
  }

  response.statusCode = 200;
  response.setHeader('Content-Type', MIME_TYPES[path.extname(targetPath)] || 'application/octet-stream');

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(targetPath).pipe(response);
}

function resolveStaticPath(pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(DIST_DIR, relativePath);
  return filePath === DIST_DIR || filePath.startsWith(`${DIST_DIR}${path.sep}`) ? filePath : null;
}

async function getExistingFilePath(filePath, pathname) {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      return filePath;
    }
  } catch {
    if (!path.extname(pathname)) {
      const indexPath = path.join(DIST_DIR, 'index.html');
      return existsSync(indexPath) ? indexPath : null;
    }
  }

  return null;
}

function assertArticleResult(result) {
  for (const field of ['title', 'lead', 'body', 'category']) {
    if (typeof result[field] !== 'string' || result[field].trim() === '') {
      throw new Error(`Gemini response is missing ${field}`);
    }
  }
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(message);
}

function sendNotFound(response) {
  sendText(response, 404, 'Not found');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
