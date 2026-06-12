import http from 'node:http';
import fs from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const distDir = path.join(__dirname, 'dist');
const loadedEnvKeys = new Set();

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

loadEnvFile('.env');
loadEnvFile('.env.local');

let vite;
if (!isProduction) {
  const { createServer } = await import('vite');
  vite = await createServer({
    appType: 'spa',
    server: { middlewareMode: true },
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/api/generate-article') {
      await handleGenerateArticle(req, res);
      return;
    }

    if (isProduction) {
      await serveStatic(requestUrl, res);
      return;
    }

    vite.middlewares(req, res, (err) => {
      if (err) {
        vite.ssrFixStacktrace(err);
        sendJson(res, 500, { error: 'Internal server error' });
        return;
      }

      serveDevIndex(requestUrl, res).catch((error) => {
        console.error(error);
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'Internal server error' });
        } else {
          res.end();
        }
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal server error' });
    } else {
      res.end();
    }
  }
});

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});

function loadEnvFile(fileName) {
  const envPath = path.join(__dirname, fileName);
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined && !loadedEnvKeys.has(key)) {
      continue;
    }

    process.env[key] = normalizeEnvValue(rawValue);
    loadedEnvKeys.add(key);
  }
}

function normalizeEnvValue(rawValue) {
  const value = rawValue.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }

  return value;
}

async function handleGenerateArticle(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: 'GEMINI_API_KEY is not configured' });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(res, error.statusCode || 400, { error: error.message });
    return;
  }

  const event = payload?.event;
  if (!isPoliceEvent(event)) {
    sendJson(res, 400, { error: 'Invalid police event payload' });
    return;
  }

  try {
    const article = await generateNewsArticle(event, apiKey);
    sendJson(res, 200, article);
  } catch (error) {
    console.error('Error generating news article with Gemini:', error);
    sendJson(res, 502, { error: 'Failed to generate article' });
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let totalSize = 0;
  const maxSize = 1024 * 1024;

  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > maxSize) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    const error = new Error('Invalid JSON payload');
    error.statusCode = 400;
    throw error;
  }
}

function isPoliceEvent(event) {
  return Boolean(
    event &&
      typeof event.id === 'number' &&
      typeof event.datetime === 'string' &&
      typeof event.name === 'string' &&
      typeof event.summary === 'string' &&
      typeof event.type === 'string' &&
      event.location &&
      typeof event.location.name === 'string'
  );
}

async function generateNewsArticle(event, apiKey) {
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
  assertGeneratedArticle(result);

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

function assertGeneratedArticle(result) {
  const requiredFields = ['title', 'lead', 'body', 'category'];
  for (const field of requiredFields) {
    if (typeof result?.[field] !== 'string' || result[field].trim() === '') {
      throw new Error(`Gemini returned an invalid article: missing ${field}`);
    }
  }
}

async function serveDevIndex(requestUrl, res) {
  try {
    const template = await readFile(path.join(__dirname, 'index.html'), 'utf8');
    const html = await vite.transformIndexHtml(requestUrl.pathname, template);
    send(res, 200, html, 'text/html; charset=utf-8');
  } catch (error) {
    vite.ssrFixStacktrace(error);
    throw error;
  }
}

async function serveStatic(requestUrl, res) {
  const filePath = resolveDistPath(requestUrl.pathname);
  if (!filePath) {
    send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      await sendFile(path.join(filePath, 'index.html'), res);
      return;
    }

    await sendFile(filePath, res);
  } catch {
    await sendFile(path.join(distDir, 'index.html'), res);
  }
}

function resolveDistPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.slice(1);
  const filePath = path.normalize(path.join(distDir, relativePath));
  const relativeToDist = path.relative(distDir, filePath);

  if (relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist)) {
    return null;
  }

  return filePath;
}

async function sendFile(filePath, res) {
  const body = await readFile(filePath);
  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
  send(res, 200, body, contentType);
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function send(res, statusCode, body, contentType) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', contentType);
  res.end(body);
}
