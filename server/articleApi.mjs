import { GoogleGenAI, Type } from '@google/genai';

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

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) {
        return;
      }

      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(new Error('Request body too large'));
      }
    });

    req.on('end', () => {
      if (tooLarge) {
        return;
      }

      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON request body'));
      }
    });

    req.on('error', reject);
  });

const isPoliceEvent = (event) =>
  event &&
  typeof event.id === 'number' &&
  typeof event.datetime === 'string' &&
  typeof event.name === 'string' &&
  typeof event.summary === 'string' &&
  typeof event.type === 'string' &&
  event.location &&
  typeof event.location.name === 'string';

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

const generateNewsArticle = async (ai, event) => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: buildPrompt(event),
    config: {
      responseMimeType: 'application/json',
      responseSchema: articleSchema,
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

export const createGenerateArticleHandler = ({ apiKey }) => {
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

  return async (req, res, next) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (!ai) {
      sendJson(res, 500, { error: 'GEMINI_API_KEY is not configured' });
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const event = payload.event;

      if (!isPoliceEvent(event)) {
        sendJson(res, 400, { error: 'Invalid police event payload' });
        return;
      }

      const article = await generateNewsArticle(ai, event);
      sendJson(res, 200, article);
    } catch (error) {
      if (error.message === 'Request body too large') {
        sendJson(res, 413, { error: error.message });
        return;
      }

      if (error.message === 'Invalid JSON request body') {
        sendJson(res, 400, { error: error.message });
        return;
      }

      console.error('Error generating news article with Gemini:', error);
      sendJson(res, 500, { error: 'Failed to generate news article' });
    }
  };
};
