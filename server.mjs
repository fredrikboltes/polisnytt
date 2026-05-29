import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3000;
const MAX_JSON_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export function parseEnv(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();

    if (!key) continue;
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

export function loadLocalEnv(rootDir = __dirname, target = process.env) {
  const loaded = {};

  for (const fileName of ['.env', '.env.local']) {
    const filePath = path.join(rootDir, fileName);
    if (!existsSync(filePath)) continue;
    Object.assign(loaded, parseEnv(readFileSync(filePath, 'utf8')));
  }

  for (const [key, value] of Object.entries(loaded)) {
    if (target[key] === undefined) {
      target[key] = value;
    }
  }

  return loaded;
}

export function createGeminiClient(apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  return new GoogleGenAI({ apiKey });
}

export function buildGeminiPrompt(event) {
  return `
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
}

export function articleFromGeminiResponse(responseText, event, now = () => Date.now()) {
  const result = JSON.parse(responseText || '{}');
  const requiredFields = ['title', 'lead', 'body', 'category'];

  for (const field of requiredFields) {
    if (typeof result[field] !== 'string' || result[field].length === 0) {
      throw new Error(`Gemini response is missing ${field}`);
    }
  }

  return {
    id: `article-${event.id}-${now()}`,
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

export async function generateArticle(event, ai = createGeminiClient(), now = () => Date.now()) {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: buildGeminiPrompt(event),
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

  return articleFromGeminiResponse(response.text, event, now);
}

function isPoliceEvent(value) {
  return (
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

async function readJsonBody(request) {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_JSON_BODY_BYTES) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
  }

  return body ? JSON.parse(body) : {};
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

export function createApiHandler({ ai, now } = {}) {
  return async function apiHandler(request, response) {
    const requestUrl = new URL(request.url || '/', 'http://localhost');

    if (requestUrl.pathname !== '/api/generate-article') {
      return false;
    }

    if (request.method !== 'POST') {
      response.writeHead(405, {
        Allow: 'POST',
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify({ error: 'Method not allowed' }));
      return true;
    }

    try {
      const body = await readJsonBody(request);
      if (!isPoliceEvent(body.event)) {
        sendJson(response, 400, { error: 'Invalid police event payload' });
        return true;
      }

      const article = await generateArticle(body.event, ai ?? createGeminiClient(), now);
      sendJson(response, 200, article);
    } catch (error) {
      const statusCode = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
      const message = statusCode === 400 ? 'Invalid JSON payload' : 'Failed to generate article';
      console.error('Error handling article generation request:', error);
      sendJson(response, statusCode, { error: message });
    }

    return true;
  };
}

function serveStatic(request, response, distDir) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const requestUrl = new URL(request.url || '/', 'http://localhost');
  const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
  let filePath = path.normalize(path.join(distDir, relativePath));

  if (!filePath.startsWith(distDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }

  const contentType = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': contentType });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

export async function createRequestListener({
  rootDir = __dirname,
  isProduction = process.env.NODE_ENV === 'production',
} = {}) {
  loadLocalEnv(rootDir);
  const apiHandler = createApiHandler();

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
      root: rootDir,
    });

    return async function requestListener(request, response) {
      if (await apiHandler(request, response)) return;

      vite.middlewares(request, response, (error) => {
        if (error) {
          vite.ssrFixStacktrace(error);
          console.error(error);
          response.writeHead(500);
          response.end('Internal Server Error');
        }
      });
    };
  }

  const distDir = path.join(rootDir, 'dist');
  return async function requestListener(request, response) {
    if (await apiHandler(request, response)) return;
    serveStatic(request, response, distDir);
  };
}

export async function startServer({
  port = Number(process.env.PORT || DEFAULT_PORT),
  rootDir = __dirname,
} = {}) {
  const listener = await createRequestListener({ rootDir });
  const server = createServer(listener);

  server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${port}`);
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
