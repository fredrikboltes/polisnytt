import { GoogleGenAI, Type } from '@google/genai';

const MAX_BODY_BYTES = 1_000_000;

const jsonResponse = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  let rejected = false;

  req.on('data', (chunk) => {
    if (rejected) return;
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      rejected = true;
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      reject(error);
    }
  });

  req.on('end', () => {
    if (rejected) return;
    try {
      resolve(JSON.parse(body || '{}'));
    } catch (error) {
      error.statusCode = 400;
      reject(error);
    }
  });

  req.on('error', reject);
});

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const isPoliceEvent = (value) => (
  value &&
  typeof value === 'object' &&
  Number.isFinite(value.id) &&
  isNonEmptyString(value.datetime) &&
  isNonEmptyString(value.name) &&
  isNonEmptyString(value.summary) &&
  isNonEmptyString(value.type) &&
  value.location &&
  typeof value.location === 'object' &&
  isNonEmptyString(value.location.name)
);

const getResponseText = (response) => {
  if (typeof response.text === 'function') {
    return response.text();
  }
  return response.text;
};

export const generateNewsArticle = async (event, { apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY } = {}) => {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

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

  const result = JSON.parse(getResponseText(response) || '{}');
  if (
    !isNonEmptyString(result.title) ||
    !isNonEmptyString(result.lead) ||
    !isNonEmptyString(result.body) ||
    !isNonEmptyString(result.category)
  ) {
    throw new Error('Gemini response did not include a complete article');
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

export const createArticleApiMiddleware = ({ apiKey, generateArticle } = {}) => {
  const articleGenerator = generateArticle || ((event) => generateNewsArticle(event, { apiKey }));

  return async (req, res, next) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      jsonResponse(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const event = payload.event;

      if (!isPoliceEvent(event)) {
        jsonResponse(res, 400, { error: 'Invalid police event payload' });
        return;
      }

      const article = await articleGenerator(event);
      jsonResponse(res, 200, { article });
    } catch (error) {
      if (error.statusCode && error.statusCode < 500) {
        jsonResponse(res, error.statusCode, { error: error.message });
        return;
      }

      console.error('Error generating article:', error);
      jsonResponse(res, 500, { error: 'Failed to generate article' });
    }
  };
};
