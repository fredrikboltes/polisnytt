import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const mode = process.env.NODE_ENV || 'development';
const isProduction = mode === 'production';
const port = Number(process.env.PORT || 3000);

loadEnvFiles(mode);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function loadEnvFiles(currentMode) {
  const originalKeys = new Set(Object.keys(process.env));
  const loaded = {};
  const files = ['.env', `.env.${currentMode}`, '.env.local', `.env.${currentMode}.local`];

  for (const file of files) {
    const filePath = path.join(rootDir, file);
    if (!existsSync(filePath)) continue;

    const contents = statSync(filePath).isFile() ? readFileSync(filePath, 'utf8') : '';
    for (const [key, value] of parseEnv(contents)) {
      loaded[key] = value;
    }
  }

  for (const [key, value] of Object.entries(loaded)) {
    if (!originalKeys.has(key)) {
      process.env[key] = value;
    }
  }
}

function parseEnv(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      if (separator === -1) return null;

      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [key, value];
    })
    .filter(Boolean);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error('Request body is too large');
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
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

async function generateNewsArticle(event) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
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
  if (!result.title || !result.lead || !result.body || !result.category) {
    throw new Error('Gemini returned an incomplete article');
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

async function handleApiRequest(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(request);
    if (!isPoliceEvent(body.event)) {
      sendJson(response, 400, { error: 'Invalid police event payload' });
      return;
    }

    const article = await generateNewsArticle(body.event);
    sendJson(response, 200, { article });
  } catch (error) {
    console.error('Error generating news article with Gemini:', error);
    sendJson(response, 500, { error: 'Could not generate article' });
  }
}

async function serveStatic(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405);
    response.end();
    return;
  }

  const distDir = path.join(rootDir, 'dist');
  const requestedPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(distDir, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(distDir)) {
    response.writeHead(403);
    response.end();
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }

  if (!existsSync(filePath)) {
    response.writeHead(404);
    response.end('Build output not found. Run `npm run build` first.');
    return;
  }

  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

async function startServer() {
  const vite = isProduction
    ? null
    : await import('vite').then(({ createServer: createViteServer }) =>
        createViteServer({
          server: { middlewareMode: true },
          appType: 'spa',
        }),
      );

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);

    if (url.pathname === '/api/generate-article') {
      await handleApiRequest(request, response);
      return;
    }

    if (vite) {
      vite.middlewares(request, response, () => {
        if (!response.writableEnded) {
          response.writeHead(404);
          response.end();
        }
      });
      return;
    }

    await serveStatic(request, response);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
