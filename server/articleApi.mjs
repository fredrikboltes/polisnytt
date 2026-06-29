import { GoogleGenAI, Type } from '@google/genai';

const API_PATH = '/api/generate-article';
const MAX_BODY_BYTES = 1024 * 1024;
const MODEL = 'gemini-3-flash-preview';

class HttpError extends Error {
  constructor(statusCode, message, expose = false) {
    super(message);
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

export function createArticleApiMiddleware(options = {}) {
  return async function articleApiMiddleware(req, res, next) {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;

    if (pathname !== API_PATH) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const event = body?.event;

      if (!isPoliceEvent(event)) {
        throw new HttpError(400, 'Invalid police event payload', true);
      }

      const article = await generateNewsArticle(event, options);
      sendJson(res, 200, article);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 502;

      if (statusCode >= 500) {
        console.error('Article API error:', error);
      }

      sendJson(res, statusCode, {
        error: error instanceof HttpError && error.expose
          ? error.message
          : 'Kunde inte generera artikel.',
      });
    }
  };
}

export async function generateNewsArticle(event, options = {}) {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;

  if (!apiKey && !options.generateContent) {
    throw new HttpError(500, 'Missing Gemini API key');
  }

  const response = await getGenerateContent(options, apiKey)({
    model: MODEL,
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

  const result = parseArticleResponse(response);

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

function getGenerateContent(options, apiKey) {
  if (options.generateContent) {
    return options.generateContent;
  }

  const ai = new GoogleGenAI({ apiKey });
  return request => ai.models.generateContent(request);
}

function buildPrompt(event) {
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

function parseArticleResponse(response) {
  let result;

  try {
    result = JSON.parse(response.text || '{}');
  } catch {
    throw new HttpError(502, 'Gemini returned invalid JSON');
  }

  for (const field of ['title', 'lead', 'body', 'category']) {
    if (typeof result[field] !== 'string' || result[field].trim() === '') {
      throw new HttpError(502, `Gemini response missing ${field}`);
    }
  }

  return result;
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body too large', true);
    }

    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON payload', true);
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function isPoliceEvent(value) {
  return Boolean(
    value
      && typeof value.id === 'number'
      && typeof value.datetime === 'string'
      && typeof value.name === 'string'
      && typeof value.summary === 'string'
      && typeof value.type === 'string'
      && value.location
      && typeof value.location.name === 'string'
  );
}
