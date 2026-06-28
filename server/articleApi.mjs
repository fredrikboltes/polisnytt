import { GoogleGenAI, Type } from '@google/genai';

export const ARTICLE_API_PATH = '/api/generate-article';

const MAX_BODY_BYTES = 1024 * 1024;

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

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

export const isValidPoliceEvent = (event) => {
  return Boolean(
    event &&
      Number.isFinite(event.id) &&
      isNonEmptyString(event.name) &&
      isNonEmptyString(event.summary) &&
      isNonEmptyString(event.type) &&
      isNonEmptyString(event.datetime) &&
      event.location &&
      isNonEmptyString(event.location.name)
  );
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

const requireArticleFields = (result) => {
  if (
    !result ||
    !isNonEmptyString(result.title) ||
    !isNonEmptyString(result.lead) ||
    !isNonEmptyString(result.body) ||
    !isNonEmptyString(result.category)
  ) {
    throw new Error('Gemini returned an incomplete article');
  }
};

export const createNewsArticle = (event, result, now = Date.now) => {
  requireArticleFields(result);

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

export const generateNewsArticleFromEvent = async (
  event,
  {
    apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY,
    client,
    now,
  } = {}
) => {
  if (!isValidPoliceEvent(event)) {
    throw new Error('Invalid police event');
  }

  const gemini = client || new GoogleGenAI({ apiKey: requireApiKey(apiKey) });
  const response = await gemini.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: buildPrompt(event),
    config: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  });

  const result = JSON.parse(response.text || '{}');
  return createNewsArticle(event, result, now);
};

const requireApiKey = (apiKey) => {
  if (!isNonEmptyString(apiKey)) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  return apiKey;
};

const readJsonBody = async (req) => {
  let size = 0;
  let body = '';

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    }
    body += chunk;
  }

  return JSON.parse(body || '{}');
};

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

export const handleGenerateArticleRequest = async (
  req,
  res,
  { generateArticle = generateNewsArticleFromEvent } = {}
) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const { event } = await readJsonBody(req);

    if (!isValidPoliceEvent(event)) {
      sendJson(res, 400, { error: 'Invalid police event' });
      return;
    }

    const article = await generateArticle(event);
    sendJson(res, 200, { article });
  } catch (error) {
    console.error('Error generating article:', error);
    const statusCode = error.statusCode || 502;
    sendJson(res, statusCode, { error: 'Failed to generate article' });
  }
};

export const createArticleApiMiddleware = (options = {}) => {
  return (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname !== ARTICLE_API_PATH) {
      next();
      return;
    }

    handleGenerateArticleRequest(req, res, options);
  };
};
