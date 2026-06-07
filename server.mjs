import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3000;
const MAX_JSON_BODY_BYTES = 1024 * 1024;

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

let aiClient;

export function loadEnvFiles(rootDir = __dirname) {
  for (const fileName of ['.env', '.env.local']) {
    const filePath = path.join(rootDir, fileName);
    if (!existsSync(filePath)) continue;

    const contents = readFileSync(filePath, 'utf8');
    for (const [key, value] of parseEnv(contents)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function parseEnv(contents) {
  const values = [];
  const text = typeof contents === 'string' ? contents : '';

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = normalized.slice(separatorIndex + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
      value = value.slice(1, -1);
    }

    values.push([key, value]);
  }

  return values;
}

function getApiKey() {
  return process.env.GEMINI_API_KEY || process.env.API_KEY || '';
}

function getAiClient() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }

  return aiClient;
}

export function buildArticle(event, generatedArticle, now = Date.now) {
  return {
    id: `article-${event.id}-${now()}`,
    originalEventId: event.id,
    title: generatedArticle.title,
    lead: generatedArticle.lead,
    body: generatedArticle.body,
    category: generatedArticle.category,
    location: event.location.name,
    timestamp: event.datetime,
    imageUrl: `https://picsum.photos/seed/${event.id}/800/450`,
  };
}

function hasGeneratedArticleShape(value) {
  return Boolean(
    value &&
      typeof value.title === 'string' &&
      typeof value.lead === 'string' &&
      typeof value.body === 'string' &&
      typeof value.category === 'string',
  );
}

export async function generateNewsArticle(event, options = {}) {
  const ai = options.ai ?? getAiClient();
  const now = options.now ?? Date.now;
  const logger = options.logger ?? console;

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

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: articleSchema,
      },
    });

    const generatedArticle = JSON.parse(response.text || '{}');
    if (!hasGeneratedArticleShape(generatedArticle)) {
      throw new Error('Gemini returned an invalid article payload');
    }

    return buildArticle(event, generatedArticle, now);
  } catch (error) {
    logger.error('Error generating news article with Gemini:', error);
    return null;
  }
}

function hasPoliceEventShape(value) {
  return Boolean(
    value &&
      typeof value.id === 'number' &&
      typeof value.datetime === 'string' &&
      typeof value.name === 'string' &&
      typeof value.summary === 'string' &&
      typeof value.type === 'string' &&
      value.location &&
      typeof value.location.name === 'string',
  );
}

async function readJsonBody(req) {
  let body = '';
  let bytes = 0;

  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_JSON_BODY_BYTES) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    body += chunk;
  }

  return JSON.parse(body || '{}');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function handleGenerateArticle(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' });
    res.end();
    return;
  }

  if (!getApiKey()) {
    sendJson(res, 500, { error: 'Gemini API key is not configured' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    if (!hasPoliceEventShape(body.event)) {
      sendJson(res, 400, { error: 'Invalid police event payload' });
      return;
    }

    const article = await generateNewsArticle(body.event);
    if (!article) {
      sendJson(res, 502, { error: 'Article generation failed' });
      return;
    }

    sendJson(res, 200, { article });
  } catch (error) {
    const statusCode = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
    sendJson(res, statusCode, { error: statusCode === 400 ? 'Invalid JSON payload' : 'Article generation failed' });
  }
}

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

async function serveStatic(req, res, rootDir) {
  const url = new URL(req.url || '/', 'http://localhost');
  const distDir = path.join(rootDir, 'dist');
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(distDir, requestedPath));
  const relativePath = path.relative(distDir, filePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error('Not a file');
    }

    res.writeHead(200, {
      'Content-Type': mimeTypes.get(path.extname(filePath)) || 'application/octet-stream',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    const indexPath = path.join(distDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    createReadStream(indexPath).pipe(res);
  }
}

export async function createAppServer(options = {}) {
  const rootDir = options.rootDir ?? __dirname;
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  loadEnvFiles(rootDir);

  let vite = null;
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      root: rootDir,
      server: { middlewareMode: true },
      appType: 'spa',
    });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname === '/api/generate-article') {
      await handleGenerateArticle(req, res);
      return;
    }

    if (vite) {
      vite.middlewares(req, res, () => {
        res.writeHead(404);
        res.end('Not found');
      });
      return;
    }

    await serveStatic(req, res, rootDir);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const host = process.env.HOST || '0.0.0.0';
  const server = await createAppServer();

  server.listen(port, host, () => {
    console.log(`Server running at http://${host}:${port}`);
  });
}
