import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const DEFAULT_PORT = 3000;
const MAX_BODY_BYTES = 1024 * 1024;
const POLICE_USER_AGENT = 'Svenska Polisnyheter AI/1.0 (https://github.com/fredrikboltes/polisnytt)';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = parseEnvValue(trimmed.slice(separatorIndex + 1));
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadServerEnv(rootDir = process.cwd(), mode = process.env.NODE_ENV || 'development') {
  loadEnvFile(path.join(rootDir, '.env'));
  loadEnvFile(path.join(rootDir, `.env.${mode}`));
  loadEnvFile(path.join(rootDir, '.env.local'));
  loadEnvFile(path.join(rootDir, `.env.${mode}.local`));
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

function isValidArticleResult(result) {
  return result
    && typeof result.title === 'string'
    && typeof result.lead === 'string'
    && typeof result.body === 'string'
    && typeof result.category === 'string';
}

function isValidPoliceEvent(event) {
  return event
    && typeof event.id === 'number'
    && typeof event.datetime === 'string'
    && typeof event.name === 'string'
    && typeof event.summary === 'string'
    && typeof event.type === 'string'
    && event.location
    && typeof event.location.name === 'string';
}

export function createArticleFromGeminiResult(event, result, now = Date.now) {
  if (!isValidPoliceEvent(event)) {
    throw new Error('Invalid police event payload');
  }
  if (!isValidArticleResult(result)) {
    throw new Error('Gemini returned an invalid article payload');
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

export async function generateArticleForEvent(event, ai, now = Date.now) {
  if (!ai) {
    throw new Error('Gemini API key is not configured');
  }

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

  const result = JSON.parse(response.text || '{}');
  return createArticleFromGeminiResult(event, result, now);
}

export async function fetchPoliceEvents(locationName, fetchImpl = globalThis.fetch) {
  const url = new URL('https://polisen.se/api/events');
  if (locationName) {
    url.searchParams.set('locationname', locationName);
  }

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': POLICE_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch police events: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Police API returned an unexpected payload');
  }

  return data;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new Error('Request body is too large');
    }
  }

  return JSON.parse(body || '{}');
}

export function createApiHandler({ ai, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  return async function handleApiRequest(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/police-events') {
      try {
        const events = await fetchPoliceEvents(url.searchParams.get('locationname') || undefined, fetchImpl);
        sendJson(res, 200, events);
      } catch (error) {
        console.error('Error fetching police events:', error);
        sendJson(res, 502, { error: 'Could not fetch police events.' });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/generate-article') {
      try {
        const { event } = await readJsonBody(req);
        if (!isValidPoliceEvent(event)) {
          sendJson(res, 400, { error: 'Invalid police event payload.' });
          return;
        }

        const article = await generateArticleForEvent(event, ai, now);
        sendJson(res, 200, article);
      } catch (error) {
        const status = error.message === 'Gemini API key is not configured' ? 500 : 502;
        console.error('Error generating news article with Gemini:', error);
        sendJson(res, status, { error: 'Could not generate news article.' });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  };
}

async function serveStatic(req, res, distDir) {
  const url = new URL(req.url || '/', 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(distDir, requestedPath));
  if (!filePath.startsWith(path.normalize(distDir + path.sep))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    const contentType = MIME_TYPES.get(path.extname(filePath)) || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (error) {
    if (!path.extname(pathname)) {
      try {
        const data = await readFile(path.join(distDir, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
        return;
      } catch {
        // Fall through to 404 below.
      }
    }

    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}

export async function startServer({
  rootDir = process.cwd(),
  mode = process.env.NODE_ENV || 'development',
  port = Number(process.env.PORT) || DEFAULT_PORT,
  host = process.env.HOST || '0.0.0.0',
} = {}) {
  loadServerEnv(rootDir, mode);

  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is not configured; article generation requests will fail.');
  }
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
  const apiHandler = createApiHandler({ ai });
  const vite = mode === 'production'
    ? null
    : await import('vite').then(({ createServer }) => createServer({
      root: rootDir,
      server: { middlewareMode: true },
      appType: 'spa',
    }));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      await apiHandler(req, res);
      return;
    }

    if (vite) {
      vite.middlewares(req, res);
      return;
    }

    await serveStatic(req, res, path.join(rootDir, 'dist'));
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      console.log(`Server listening on http://${host}:${port}`);
      resolve(server);
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
