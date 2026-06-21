import { GoogleGenAI, Type } from '@google/genai';

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const MAX_BODY_BYTES = 1024 * 1024;

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

const jsonResponse = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  let bytes = 0;

  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    bytes += Buffer.byteLength(chunk, 'utf8');
    if (bytes > MAX_BODY_BYTES) {
      reject(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
      req.destroy();
      return;
    }
    body += chunk;
  });
  req.on('end', () => {
    try {
      resolve(body ? JSON.parse(body) : {});
    } catch {
      reject(Object.assign(new Error('Invalid JSON request body'), { statusCode: 400 }));
    }
  });
  req.on('error', reject);
});

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const isPoliceEvent = (event) => (
  event &&
  typeof event.id === 'number' &&
  isNonEmptyString(event.datetime) &&
  isNonEmptyString(event.name) &&
  isNonEmptyString(event.summary) &&
  isNonEmptyString(event.type) &&
  event.location &&
  isNonEmptyString(event.location.name)
);

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

const normalizeGeneratedArticle = (event, generated) => {
  if (
    !isNonEmptyString(generated.title) ||
    !isNonEmptyString(generated.lead) ||
    !isNonEmptyString(generated.body) ||
    !isNonEmptyString(generated.category)
  ) {
    throw new Error('Gemini response did not contain a complete article');
  }

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

export const generateArticleFromEvent = async (event, { ai, model = DEFAULT_MODEL } = {}) => {
  if (!isPoliceEvent(event)) {
    throw Object.assign(new Error('Invalid police event payload'), { statusCode: 400 });
  }

  const response = await ai.models.generateContent({
    model,
    contents: buildPrompt(event),
    config: {
      responseMimeType: 'application/json',
      responseSchema: articleSchema,
    },
  });

  const generated = JSON.parse(response.text || '{}');
  return normalizeGeneratedArticle(event, generated);
};

export const createArticleApiMiddleware = ({
  apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY,
  createAI = (key) => new GoogleGenAI({ apiKey: key }),
  model = DEFAULT_MODEL,
} = {}) => {
  let ai;

  return async (req, res, next) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (requestUrl.pathname !== '/api/generate-article') {
      next();
      return;
    }

    if (req.method !== 'POST') {
      jsonResponse(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (!apiKey) {
      jsonResponse(res, 500, { error: 'Gemini API key is not configured' });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      ai ??= createAI(apiKey);
      const article = await generateArticleFromEvent(payload.event, { ai, model });
      jsonResponse(res, 200, { article });
    } catch (error) {
      console.error('Article generation failed:', error);
      jsonResponse(res, error.statusCode || 500, {
        error: error.statusCode ? error.message : 'Failed to generate article',
      });
    }
  };
};
