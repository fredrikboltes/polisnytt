import { createReadStream, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, 'dist');
const MAX_JSON_BYTES = 1024 * 1024;

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

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
]);

export function loadEnvFiles(directory = rootDir) {
  const existingEnvKeys = new Set(Object.keys(process.env));

  for (const fileName of ['.env', '.env.local']) {
    const filePath = path.join(directory, fileName);
    let contents;

    try {
      contents = readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      continue;
    }

    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (!key || existingEnvKeys.has(key)) {
        continue;
      }

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }
}

export function buildArticlePrompt(event) {
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
    typeof value.location.name === 'string'
  );
}

function isGeneratedArticle(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.title === 'string' &&
    typeof value.lead === 'string' &&
    typeof value.body === 'string' &&
    typeof value.category === 'string'
  );
}

export async function generateNewsArticle(event, apiKey = process.env.GEMINI_API_KEY) {
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is not configured.');
    error.statusCode = 503;
    throw error;
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: buildArticlePrompt(event),
    config: {
      responseMimeType: 'application/json',
      responseSchema: articleSchema,
    },
  });

  const result = JSON.parse(response.text || '{}');
  if (!isGeneratedArticle(result)) {
    throw new Error('Gemini returned an invalid article payload.');
  }

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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_JSON_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
  }

  return JSON.parse(body || '{}');
}

export async function handleApiRequest(request, response) {
  const requestUrl = new URL(request.url || '/', 'http://localhost');
  if (requestUrl.pathname !== '/api/generate-article') {
    return false;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return true;
  }

  try {
    const body = await readJsonBody(request);
    if (!isPoliceEvent(body.event)) {
      sendJson(response, 400, { error: 'Invalid police event payload.' });
      return true;
    }

    const article = await generateNewsArticle(body.event);
    sendJson(response, 200, { article });
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    console.error('Error generating news article:', error);
    sendJson(response, statusCode, {
      error: statusCode === 503
        ? 'Article generation is not configured.'
        : 'Failed to generate news article.',
    });
  }

  return true;
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url || '/', 'http://localhost');
  let pathname;

  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }

  let filePath = path.resolve(distDir, `.${pathname}`);
  if (!filePath.startsWith(`${distDir}${path.sep}`) && filePath !== distDir) {
    response.writeHead(403);
    response.end('Forbidden');
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

  response.writeHead(200, {
    'Content-Type': contentTypes.get(path.extname(filePath)) || 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}

export async function createAppServer({ production = process.env.NODE_ENV === 'production' } = {}) {
  loadEnvFiles(rootDir);

  if (production) {
    return createHttpServer(async (request, response) => {
      if (await handleApiRequest(request, response)) {
        return;
      }
      await serveStatic(request, response);
    });
  }

  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: rootDir,
    appType: 'spa',
    server: { middlewareMode: true },
  });

  return createHttpServer(async (request, response) => {
    if (await handleApiRequest(request, response)) {
      return;
    }
    vite.middlewares(request, response);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  const server = await createAppServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}
