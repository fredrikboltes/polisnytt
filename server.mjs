import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');
const originalEnvKeys = new Set(Object.keys(process.env));

const ARTICLE_SCHEMA = {
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

export const loadLocalEnv = async () => {
  for (const filename of ['.env', '.env.local']) {
    const filePath = path.join(__dirname, filename);
    let contents;

    try {
      contents = await readFile(filePath, 'utf8');
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

      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) {
        continue;
      }

      const [, key, rawValue] = match;
      if (originalEnvKeys.has(key)) {
        continue;
      }

      process.env[key] = parseEnvValue(rawValue);
    }
  }
};

const parseEnvValue = (rawValue) => {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const buildPrompt = (event) => `
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

const validatePoliceEvent = (event) => {
  return (
    event &&
    typeof event.id === 'number' &&
    typeof event.datetime === 'string' &&
    typeof event.name === 'string' &&
    typeof event.summary === 'string' &&
    typeof event.type === 'string' &&
    event.location &&
    typeof event.location.name === 'string'
  );
};

const validateGeneratedArticle = (article) => {
  return ['title', 'lead', 'body', 'category'].every(
    (key) => typeof article?.[key] === 'string' && article[key].trim().length > 0,
  );
};

const createNewsArticle = (event, generatedArticle) => ({
  id: `article-${event.id}-${Date.now()}`,
  originalEventId: event.id,
  title: generatedArticle.title,
  lead: generatedArticle.lead,
  body: generatedArticle.body,
  category: generatedArticle.category,
  location: event.location.name,
  timestamp: event.datetime,
  imageUrl: `https://picsum.photos/seed/${event.id}/800/450`,
});

export const generateArticle = async (event) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: buildPrompt(event),
    config: {
      responseMimeType: 'application/json',
      responseSchema: ARTICLE_SCHEMA,
    },
  });

  const generatedArticle = JSON.parse(response.text || '{}');
  if (!validateGeneratedArticle(generatedArticle)) {
    throw new Error('Gemini response did not contain a complete article');
  }

  return createNewsArticle(event, generatedArticle);
};

const readJsonBody = (request, maxBytes = 1024 * 1024) => {
  return new Promise((resolve, reject) => {
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Invalid JSON request body'));
      }
    });
    request.on('error', reject);
  });
};

const sendJson = (response, statusCode, body) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
};

const handleGenerateArticle = async (request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' });
    response.end();
    return;
  }

  try {
    const body = await readJsonBody(request);
    const { event } = body;

    if (!validatePoliceEvent(event)) {
      sendJson(response, 400, { error: 'Invalid police event payload' });
      return;
    }

    const article = await generateArticle(event);
    sendJson(response, 200, article);
  } catch (error) {
    console.error('Error generating news article with Gemini:', error);
    sendJson(response, 500, { error: 'Failed to generate news article' });
  }
};

const serveStaticFile = async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const normalizedPath = path.normalize(requestedPath);

  if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  const filePath = path.join(distDir, normalizedPath);

  try {
    const file = await readFile(filePath);
    const contentType = contentTypes.get(path.extname(filePath)) || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(file);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    const indexHtml = await readFile(path.join(distDir, 'index.html'));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(indexHtml);
  }
};

export const createRequestHandler = async ({ isProduction = process.env.NODE_ENV === 'production' } = {}) => {
  const vite = isProduction
    ? null
    : await import('vite').then(({ createServer: createViteServer }) =>
        createViteServer({
          server: { middlewareMode: true },
          appType: 'spa',
        }),
      );

  return async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');

    if (url.pathname === '/api/generate-article') {
      await handleGenerateArticle(request, response);
      return;
    }

    if (vite) {
      vite.middlewares(request, response, () => {
        response.writeHead(404);
        response.end('Not found');
      });
      return;
    }

    await serveStaticFile(request, response);
  };
};

export const startServer = async () => {
  await loadLocalEnv();
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';
  const requestHandler = await createRequestHandler();
  const server = createServer((request, response) => {
    requestHandler(request, response).catch((error) => {
      console.error('Unhandled server error:', error);
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'Internal server error' });
      } else {
        response.end();
      }
    });
  });

  server.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}`);
  });

  return server;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
