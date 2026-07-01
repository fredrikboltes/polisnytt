import { GoogleGenAI, Type } from '@google/genai';

const ARTICLE_PATH = '/api/generate-article';

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

const requiredStringFields = ['name', 'summary', 'type', 'datetime'];

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = '';

  req.setEncoding?.('utf8');
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      resolve(JSON.parse(body || '{}'));
    } catch (error) {
      reject(new Error('Invalid JSON request body'));
    }
  });
  req.on('error', reject);
});

const assertPoliceEvent = (event) => {
  if (!event || typeof event !== 'object') {
    throw new Error('Missing police event');
  }

  if (typeof event.id !== 'number') {
    throw new Error('Police event is missing id');
  }

  for (const field of requiredStringFields) {
    if (typeof event[field] !== 'string') {
      throw new Error(`Police event is missing ${field}`);
    }
  }

  if (!event.location || typeof event.location.name !== 'string') {
    throw new Error('Police event is missing location');
  }
};

export const buildArticleFromEvent = async (event, ai, now = Date.now) => {
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

  return {
    id: `article-${event.id}-${now()}`,
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

export const createArticleApiMiddleware = ({
  apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY,
  aiFactory = (key) => new GoogleGenAI({ apiKey: key }),
  now = Date.now,
} = {}) => {
  let ai;

  return async (req, res, next) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');

    if (requestUrl.pathname !== ARTICLE_PATH) {
      next?.();
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (!apiKey) {
      sendJson(res, 500, { error: 'GEMINI_API_KEY is not configured' });
      return;
    }

    try {
      const event = await readJsonBody(req);
      assertPoliceEvent(event);

      ai ??= aiFactory(apiKey);
      const article = await buildArticleFromEvent(event, ai, now);

      sendJson(res, 200, { article });
    } catch (error) {
      console.error('Error generating news article:', error);
      sendJson(res, 500, { error: 'Failed to generate article' });
    }
  };
};
