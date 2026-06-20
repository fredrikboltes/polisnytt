import { GoogleGenAI, Type } from '@google/genai';

const MAX_BODY_BYTES = 1024 * 1024;

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const readJsonBody = async (req) => {
  let body = '';

  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      throw new RequestError(413, 'Request body is too large');
    }
  }

  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new RequestError(400, 'Request body must be valid JSON');
  }
};

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

const isPoliceEvent = (event) => (
  event
  && typeof event.id === 'number'
  && typeof event.datetime === 'string'
  && typeof event.name === 'string'
  && typeof event.summary === 'string'
  && typeof event.type === 'string'
  && event.location
  && typeof event.location.name === 'string'
);

const getTextResponse = (response) => (
  typeof response.text === 'function' ? response.text() : response.text
);

export const generateArticleFromEvent = async (event, { apiKey, ai, now = Date.now } = {}) => {
  if (!isPoliceEvent(event)) {
    throw new RequestError(400, 'Missing or invalid police event');
  }

  if (!apiKey && !ai) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const client = ai ?? new GoogleGenAI({ apiKey });

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

  const response = await client.models.generateContent({
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

  const result = JSON.parse(await getTextResponse(response) || '{}');
  if (
    typeof result.title !== 'string'
    || typeof result.lead !== 'string'
    || typeof result.body !== 'string'
    || typeof result.category !== 'string'
  ) {
    throw new Error('Gemini response did not include a complete article');
  }

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

export const setupArticleApi = (middlewares, { apiKey, ai, now } = {}) => {
  middlewares.use('/api/generate-article', async (req, res) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const article = await generateArticleFromEvent(body.event, { apiKey, ai, now });
      sendJson(res, 200, article);
    } catch (error) {
      const statusCode = error instanceof RequestError ? error.statusCode : 500;
      if (statusCode === 500) {
        console.error('Error generating news article with Gemini:', error);
      }
      sendJson(res, statusCode, {
        error: statusCode === 500 ? 'Failed to generate article' : error.message,
      });
    }
  });
};
