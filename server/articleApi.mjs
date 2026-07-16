import { GoogleGenAI, Type } from '@google/genai';

const ARTICLE_ROUTE = '/api/generate-article';
const MAX_REQUEST_BYTES = 64 * 1024;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sendJson = (response, status, body) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

const readJson = async request => {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new RequestError(413, 'Request body is too large.');
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Request body must be valid JSON.');
  }
};

const requireString = (value, field) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RequestError(400, `Missing or invalid ${field}.`);
  }
  return value;
};

const validateEvent = value => {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.id)) {
    throw new RequestError(400, 'Missing or invalid event.');
  }

  return {
    id: value.id,
    datetime: requireString(value.datetime, 'event.datetime'),
    name: requireString(value.name, 'event.name'),
    summary: requireString(value.summary, 'event.summary'),
    type: requireString(value.type, 'event.type'),
    location: {
      name: requireString(value.location?.name, 'event.location.name'),
    },
  };
};

const validateGeneratedArticle = value => {
  if (!value || typeof value !== 'object') {
    throw new Error('Gemini returned an invalid article.');
  }

  const generatedString = (field) => {
    if (typeof value[field] !== 'string' || value[field].trim() === '') {
      throw new Error(`Gemini returned an invalid ${field}.`);
    }
    return value[field];
  };

  return {
    title: generatedString('title'),
    lead: generatedString('lead'),
    body: generatedString('body'),
    category: generatedString('category'),
  };
};

const buildPrompt = event => `
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

export const createArticleApiHandler = ({
  apiKey,
  createClient = key => new GoogleGenAI({ apiKey: key }),
} = {}) => {
  let client;

  return async (request, response, next) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== ARTICLE_ROUTE) {
      next();
      return;
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }

    try {
      if (!apiKey) {
        throw new RequestError(503, 'Article generation is not configured.');
      }

      const event = validateEvent((await readJson(request)).event);
      client ??= createClient(apiKey);
      const generated = await client.models.generateContent({
        model: 'gemini-3-flash-preview',
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

      const article = validateGeneratedArticle(JSON.parse(generated.text || '{}'));
      sendJson(response, 200, {
        id: `article-${event.id}-${Date.now()}`,
        originalEventId: event.id,
        ...article,
        location: event.location.name,
        timestamp: event.datetime,
        imageUrl: `https://picsum.photos/seed/${event.id}/800/450`,
      });
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 502;
      const message = error instanceof RequestError
        ? error.message
        : 'Article generation failed.';
      if (status === 502) {
        console.error('Error generating news article with Gemini:', error);
      }
      sendJson(response, status, { error: message });
    }
  };
};
