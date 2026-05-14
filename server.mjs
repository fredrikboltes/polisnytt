import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const distDir = path.join(__dirname, 'dist');
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const responseSchema = {
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
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

const sendJson = (res, statusCode, body) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readJsonBody = async (req) => {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};

const createPrompt = (event) => `
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

const isPoliceEvent = (event) => (
  event &&
  typeof event.id === 'number' &&
  typeof event.datetime === 'string' &&
  typeof event.name === 'string' &&
  typeof event.summary === 'string' &&
  typeof event.type === 'string' &&
  event.location &&
  typeof event.location.name === 'string'
);

const generateArticle = async (event) => {
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: createPrompt(event),
    config: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  });

  const result = JSON.parse(response.text || '{}');

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
};

const handleGenerateArticle = async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' });
    res.end();
    return true;
  }

  try {
    const { event } = await readJsonBody(req);
    if (!isPoliceEvent(event)) {
      sendJson(res, 400, { error: 'Invalid police event payload' });
      return true;
    }

    const article = await generateArticle(event);
    sendJson(res, 200, article);
  } catch (error) {
    console.error('Error generating news article with Gemini:', error);
    const statusCode = error.message === 'Request body too large' ? 413 : 500;
    sendJson(res, statusCode, { error: 'Failed to generate article' });
  }

  return true;
};

const serveStatic = async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const safePath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(distDir, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
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

  const extension = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': mimeTypes.get(extension) || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
};

const startServer = async () => {
  let vite;
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/generate-article') {
      await handleGenerateArticle(req, res);
      return;
    }

    if (vite) {
      vite.middlewares(req, res);
      return;
    }

    await serveStatic(req, res);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
};

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
