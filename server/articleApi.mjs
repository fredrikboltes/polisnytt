import { GoogleGenAI, Type } from '@google/genai';

const ARTICLE_API_PATH = '/api/generate-article';
const MAX_BODY_BYTES = 64 * 1024;

const articleResponseSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    lead: { type: Type.STRING },
    body: { type: Type.STRING },
    category: { type: Type.STRING },
  },
  required: ['title', 'lead', 'body', 'category'],
};

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

export const isPoliceEvent = (event) =>
  event &&
  typeof event.id === 'number' &&
  isNonEmptyString(event.datetime) &&
  isNonEmptyString(event.name) &&
  isNonEmptyString(event.summary) &&
  isNonEmptyString(event.type) &&
  event.location &&
  isNonEmptyString(event.location.name);

export const buildArticlePrompt = (event) => `
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

export const generateArticleFromEvent = async (event, ai) => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: buildArticlePrompt(event),
    config: {
      responseMimeType: 'application/json',
      responseSchema: articleResponseSchema,
    },
  });

  const result = JSON.parse(response.text || '{}');
  if (
    !isNonEmptyString(result.title) ||
    !isNonEmptyString(result.lead) ||
    !isNonEmptyString(result.body) ||
    !isNonEmptyString(result.category)
  ) {
    throw new Error('Gemini returned an invalid article payload');
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

export const createArticleApiHandler = ({ apiKey, ai } = {}) => {
  let articleAi = ai;

  return async (req, res, next) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (requestUrl.pathname !== ARTICLE_API_PATH) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (!apiKey && !articleAi) {
      sendJson(res, 503, { error: 'Gemini API key is not configured' });
      return;
    }

    try {
      const rawBody = await readRequestBody(req);
      const payload = JSON.parse(rawBody || '{}');
      const event = payload.event;

      if (!isPoliceEvent(event)) {
        sendJson(res, 400, { error: 'Invalid police event payload' });
        return;
      }

      articleAi ||= new GoogleGenAI({ apiKey });
      const article = await generateArticleFromEvent(event, articleAi);
      sendJson(res, 200, { article });
    } catch (error) {
      console.error('Error generating news article with Gemini:', error);
      sendJson(res, 500, { error: 'Failed to generate article' });
    }
  };
};

export const installArticleApiMiddleware = (middlewares, options) => {
  middlewares.use(createArticleApiHandler(options));
};
