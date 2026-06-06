import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const distDir = path.join(root, 'dist');
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const MAX_BODY_BYTES = 1024 * 1024;

loadEnvFiles(['.env', '.env.local']);

let viteServerPromise;
let geminiClientPromise;

const json = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = '';

  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      reject(new Error('Request body is too large'));
      req.destroy();
    }
  });
  req.on('end', () => {
    try {
      resolve(JSON.parse(body || '{}'));
    } catch {
      reject(new Error('Request body must be valid JSON'));
    }
  });
  req.on('error', reject);
});

const getGeminiClient = async () => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  if (!geminiClientPromise) {
    geminiClientPromise = import('@google/genai').then(({ GoogleGenAI, Type }) => ({
      ai: new GoogleGenAI({ apiKey }),
      Type,
    }));
  }

  return geminiClientPromise;
};

const requireString = (value, field) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`event.${field} is required`);
  }

  return value;
};

const normalizeEvent = (event) => {
  if (!event || typeof event !== 'object') {
    throw new Error('event is required');
  }

  if (!Number.isFinite(event.id)) {
    throw new Error('event.id is required');
  }

  return {
    id: event.id,
    datetime: requireString(event.datetime, 'datetime'),
    name: requireString(event.name, 'name'),
    summary: requireString(event.summary, 'summary'),
    type: requireString(event.type, 'type'),
    location: {
      name: requireString(event.location?.name, 'location.name'),
    },
  };
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

const parseGeneratedArticle = (text) => {
  const parsed = JSON.parse(text || '{}');
  const title = requireString(parsed.title, 'generated.title');
  const lead = requireString(parsed.lead, 'generated.lead');
  const body = requireString(parsed.body, 'generated.body');
  const category = requireString(parsed.category, 'generated.category');

  return { title, lead, body, category };
};

export const generateNewsArticle = async (rawEvent) => {
  const event = normalizeEvent(rawEvent);
  const { ai, Type } = await getGeminiClient();

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
    contents: buildPrompt(event),
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

  const generated = parseGeneratedArticle(response.text);

  return {
    id: `article-${event.id}-${Date.now()}`,
    originalEventId: event.id,
    title: generated.title,
    lead: generated.lead,
    body: generated.body,
    category: generated.category,
    location: event.location.name,
    timestamp: event.datetime,
    imageUrl: `https://picsum.photos/seed/${event.id}/800/450`,
  };
};

const handleGenerateArticle = async (req, res) => {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return true;
  }

  try {
    const body = await readJsonBody(req);
    const article = await generateNewsArticle(body.event);
    json(res, 200, article);
  } catch (error) {
    console.error('Error generating news article with Gemini:', error);
    const statusCode = error.message?.includes('required') || error.message?.includes('valid JSON') ? 400 : 500;
    json(res, statusCode, { error: 'Failed to generate article' });
  }

  return true;
};

const getContentType = (filePath) => {
  const ext = path.extname(filePath);
  switch (ext) {
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
    default:
      return 'application/octet-stream';
  }
};

const serveStatic = async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const normalizedPath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const requestedPath = path.join(distDir, normalizedPath);
  const candidatePath = existsSync(requestedPath) && !requestedPath.endsWith(path.sep)
    ? requestedPath
    : path.join(distDir, 'index.html');

  if (!candidatePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const contents = await readFile(candidatePath);
    res.writeHead(200, {
      'Content-Type': getContentType(candidatePath),
    });
    res.end(contents);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
};

const getViteServer = async () => {
  if (!viteServerPromise) {
    viteServerPromise = import('vite').then(({ createServer: createViteServer }) => createViteServer({
      root,
      appType: 'spa',
      server: {
        middlewareMode: true,
      },
    }));
  }

  return viteServerPromise;
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/generate-article') {
    await handleGenerateArticle(req, res);
    return;
  }

  if (isProduction) {
    await serveStatic(req, res);
    return;
  }

  const vite = await getViteServer();
  vite.middlewares(req, res, (error) => {
    if (error) {
      vite.ssrFixStacktrace(error);
      console.error(error);
      res.writeHead(500);
      res.end(error.message);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`Polisnyheter server listening on http://localhost:${port}`);
  });
}

function loadEnvFiles(files) {
  for (const file of files) {
    const filePath = path.join(root, file);
    if (!existsSync(filePath)) {
      continue;
    }

    const lines = String(readFileSyncForEnv(filePath)).split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function readFileSyncForEnv(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}
