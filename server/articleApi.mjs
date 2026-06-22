import { GoogleGenAI, Type } from '@google/genai';

const ARTICLE_ROUTE = '/api/generate-article';
const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';

    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new HttpError(400, 'Request body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const isPoliceEvent = (event) =>
  event &&
  typeof event.id === 'number' &&
  typeof event.datetime === 'string' &&
  typeof event.name === 'string' &&
  typeof event.summary === 'string' &&
  typeof event.type === 'string' &&
  event.location &&
  typeof event.location.name === 'string';

export const generateArticleFromEvent = async (event, { apiKey, createClient } = {}) => {
  if (!apiKey) {
    throw new HttpError(500, 'Gemini API key is not configured');
  }

  const ai = createClient ? createClient(apiKey) : new GoogleGenAI({ apiKey });
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
  if (
    typeof result.title !== 'string' ||
    typeof result.lead !== 'string' ||
    typeof result.body !== 'string' ||
    typeof result.category !== 'string'
  ) {
    throw new HttpError(502, 'Gemini returned an invalid article');
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
};

export const createArticleApiMiddleware = ({ apiKey, createClient } = {}) => async (req, res, next) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== ARTICLE_ROUTE) {
    next();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    if (!isPoliceEvent(body.event)) {
      throw new HttpError(400, 'A valid police event is required');
    }

    const article = await generateArticleFromEvent(body.event, {
      apiKey: apiKey || process.env.GEMINI_API_KEY || process.env.API_KEY,
      createClient,
    });

    sendJson(res, 200, { article });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    if (statusCode >= 500) {
      console.error('Error generating news article with Gemini:', error);
    }
    sendJson(res, statusCode, { error: error.message || 'Failed to generate article' });
  }
};
