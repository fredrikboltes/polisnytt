import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDistDir = resolve(__dirname, 'dist');
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

loadEnvFiles(['.env', '.env.local']);

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const vite = isProduction ? null : await createViteMiddleware();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/generate-article') {
      await handleGenerateArticle(req, res);
      return;
    }

    if (vite) {
      await new Promise((resolvePromise, reject) => {
        vite.middlewares(req, res, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolvePromise();
        });
      });

      if (!res.writableEnded) {
        sendJson(res, 404, { error: 'Not found' });
      }
      return;
    }

    await serveStaticAsset(url.pathname, res);
  } catch (error) {
    console.error(error);
    if (!res.writableEnded) {
      sendJson(res, error.statusCode || 500, { error: error.publicMessage || 'Internal server error' });
    }
  }
});

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});

async function createViteMiddleware() {
  const { createServer: createViteServer } = await import('vite');

  return createViteServer({
    server: {
      middlewareMode: true,
    },
    appType: 'spa',
  });
}

async function handleGenerateArticle(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
    return;
  }

  if (!ai) {
    sendJson(res, 500, { error: 'GEMINI_API_KEY is not configured' });
    return;
  }

  const payload = await readJsonBody(req);
  const event = payload.event;

  if (!isPoliceEvent(event)) {
    sendJson(res, 400, { error: 'Invalid police event payload' });
    return;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: buildArticlePrompt(event),
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
    throw Object.assign(new Error('Gemini returned an invalid article payload'), {
      publicMessage: 'Article generation failed',
      statusCode: 502,
    });
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

function buildArticlePrompt(event) {
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

async function readJsonBody(req) {
  let body = '';

  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 1_000_000) {
      throw Object.assign(new Error('Request body too large'), {
        publicMessage: 'Request body too large',
        statusCode: 413,
      });
    }
  }

  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON request body'), {
      publicMessage: 'Invalid JSON request body',
      statusCode: 400,
    });
  }
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
      typeof value.location.name === 'string',
  );
}

function isGeneratedArticle(value) {
  return Boolean(
    value &&
      typeof value.title === 'string' &&
      typeof value.lead === 'string' &&
      typeof value.body === 'string' &&
      typeof value.category === 'string',
  );
}

async function serveStaticAsset(pathname, res) {
  let requestedPath;

  try {
    requestedPath = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { error: 'Invalid URL path' });
    return;
  }

  const candidatePath = resolve(publicDistDir, `.${requestedPath === '/' ? '/index.html' : requestedPath}`);

  if (!candidatePath.startsWith(`${publicDistDir}${sep}`) && candidatePath !== publicDistDir) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  const filePath = await resolveAssetPath(candidatePath, requestedPath);

  if (!filePath) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
  });
  createReadStream(filePath).pipe(res);
}

async function resolveAssetPath(candidatePath, requestedPath) {
  try {
    const fileStat = await stat(candidatePath);
    if (!fileStat.isDirectory()) {
      return candidatePath;
    }

    const indexPath = join(candidatePath, 'index.html');
    await stat(indexPath);
    return indexPath;
  } catch {
    if (!extname(requestedPath)) {
      const indexPath = join(publicDistDir, 'index.html');
      return existsSync(indexPath) ? indexPath : null;
    }
    return null;
  }
}

function contentTypeFor(filePath) {
  switch (extname(filePath)) {
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
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function loadEnvFiles(files) {
  const shellEnvKeys = new Set(Object.keys(process.env));

  for (const file of files) {
    const filePath = join(__dirname, file);

    if (!existsSync(filePath)) {
      continue;
    }

    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);

    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);

      if (!match || match[1].startsWith('#') || shellEnvKeys.has(match[1])) {
        continue;
      }

      process.env[match[1]] = unquoteEnvValue(match[2] || '');
    }
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}
