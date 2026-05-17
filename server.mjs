import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, 'dist');
const MAX_BODY_BYTES = 1024 * 1024;
const LOCAL_ENV_FILES = ['.env', '.env.local'];

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

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

export const getGeminiApiKey = (env = process.env) => env.GEMINI_API_KEY || env.API_KEY || '';

export const loadLocalEnv = async ({ rootDir = __dirname, env = process.env } = {}) => {
  const originalKeys = new Set(Object.keys(env));

  for (const fileName of LOCAL_ENV_FILES) {
    try {
      const contents = await readFile(path.join(rootDir, fileName), 'utf8');
      for (const line of contents.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
        if (!match) {
          continue;
        }

        const [, key, rawValue = ''] = match;
        if (originalKeys.has(key)) {
          continue;
        }

        const value = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
        env[key] = value;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
};

export const buildNewsArticle = (event, result, now = Date.now()) => ({
  id: `article-${event.id}-${now}`,
  originalEventId: event.id,
  title: result.title,
  lead: result.lead,
  body: result.body,
  category: result.category,
  location: event.location.name,
  timestamp: event.datetime,
  imageUrl: `https://picsum.photos/seed/${event.id}/800/450`,
});

export const generateNewsArticle = async (event, apiKey = getGeminiApiKey()) => {
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
      responseSchema: articleSchema,
    },
  });

  const result = JSON.parse(response.text || '{}');
  return buildNewsArticle(event, result);
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
};

const readJsonBody = async (req) => {
  let body = '';
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    body += chunk;
  }

  return JSON.parse(body || '{}');
};

const isPoliceEvent = (value) => (
  value
  && typeof value.id === 'number'
  && typeof value.datetime === 'string'
  && typeof value.name === 'string'
  && typeof value.summary === 'string'
  && typeof value.type === 'string'
  && value.location
  && typeof value.location.name === 'string'
);

const handleGenerateArticle = async (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const { event } = await readJsonBody(req);
    if (!isPoliceEvent(event)) {
      sendJson(res, 400, { error: 'Invalid police event payload' });
      return;
    }

    const article = await generateNewsArticle(event);
    sendJson(res, 200, article);
  } catch (error) {
    console.error('Error generating news article with Gemini:', error);
    sendJson(res, error.statusCode || 500, { error: 'Failed to generate article' });
  }
};

const serveStaticFile = async (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const filePath = path.resolve(DIST_DIR, `.${decodeURIComponent(pathname)}`);

  if (!filePath.startsWith(`${DIST_DIR}${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error('Not a file');
    }

    const contentType = mimeTypes.get(path.extname(filePath)) || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    createReadStream(filePath).pipe(res);
  } catch {
    const indexPath = path.join(DIST_DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    createReadStream(indexPath).pipe(res);
  }
};

export const createRequestHandler = async ({ dev = process.env.NODE_ENV !== 'production' } = {}) => {
  const vite = dev
    ? await import('vite').then(({ createServer }) => createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    }))
    : null;

  return async (req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');

    if (requestUrl.pathname === '/api/generate-article') {
      await handleGenerateArticle(req, res);
      return;
    }

    if (vite) {
      await new Promise((resolve, reject) => {
        const resolveOnFinish = () => {
          resolve();
        };
        res.once('finish', resolveOnFinish);
        vite.middlewares(req, res, (error) => {
          res.off('finish', resolveOnFinish);
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      return;
    }

    await serveStaticFile(req, res);
  };
};

export const startServer = async ({
  host = process.env.HOST || '0.0.0.0',
  port = Number(process.env.PORT || 3000),
} = {}) => {
  await loadLocalEnv();
  const handler = await createRequestHandler();
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      console.error('Unhandled server error:', error);
      sendJson(res, 500, { error: 'Internal server error' });
    });
  });

  await new Promise((resolve) => {
    server.listen(port, host, resolve);
  });

  console.log(`Server listening on http://${host}:${port}`);
  return server;
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
