import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);

await loadLocalEnv();

const vite = isProduction
  ? null
  : await import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      }),
    );

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/generate-article') {
      await handleGenerateArticle(req, res);
      return;
    }

    if (!isProduction && vite) {
      vite.middlewares(req, res);
      return;
    }

    await serveStaticAsset(req, res);
  } catch (error) {
    console.error('Request failed:', error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});

async function handleGenerateArticle(req, res) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: 'Gemini API key is not configured' });
    return;
  }

  const { event } = await readJsonBody(req);
  if (!isPoliceEvent(event)) {
    sendJson(res, 400, { error: 'Invalid police event payload' });
    return;
  }

  const ai = new GoogleGenAI({ apiKey });
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
    throw new Error('Gemini returned an invalid article payload');
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
    if (body.length > 1024 * 1024) {
      throw new Error('Request body is too large');
    }
  }

  return body ? JSON.parse(body) : {};
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

function isGeneratedArticle(value) {
  return (
    value &&
    typeof value.title === 'string' &&
    typeof value.lead === 'string' &&
    typeof value.body === 'string' &&
    typeof value.category === 'string'
  );
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function serveStaticAsset(req, res) {
  const distDir = path.join(__dirname, 'dist');
  const requestPath = new URL(req.url || '/', 'http://localhost').pathname;
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, '');
  const assetPath = path.join(distDir, safePath === '/' ? 'index.html' : safePath);
  const resolvedPath = assetPath.startsWith(distDir) && existsSync(assetPath)
    ? assetPath
    : path.join(distDir, 'index.html');

  if (!existsSync(resolvedPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': contentTypeFor(resolvedPath) });
  createReadStream(resolvedPath).pipe(res);
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath);
  const contentTypes = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
  };

  return contentTypes[extension] || 'application/octet-stream';
}

async function loadLocalEnv() {
  for (const fileName of ['.env', '.env.local']) {
    const envPath = path.join(__dirname, fileName);
    if (!existsSync(envPath)) continue;

    const contents = await readFile(envPath, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!match) continue;

      const [, key, rawValue = ''] = match;
      if (process.env[key] !== undefined) continue;

      process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}
