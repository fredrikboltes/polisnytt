import { GoogleGenAI, Type } from '@google/genai';

const API_PATH = '/api/generate-article';
const MAX_BODY_SIZE = 64 * 1024;

const sendJson = (response, statusCode, body) => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

const readJsonBody = async (request) => {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_SIZE) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
  }

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
};

const isPoliceEvent = (event) => (
  event
  && Number.isInteger(event.id)
  && typeof event.datetime === 'string'
  && typeof event.name === 'string'
  && typeof event.summary === 'string'
  && typeof event.type === 'string'
  && event.location
  && typeof event.location.name === 'string'
);

const isGeneratedArticle = (article) => (
  article
  && typeof article.title === 'string'
  && typeof article.lead === 'string'
  && typeof article.body === 'string'
  && typeof article.category === 'string'
);

export const generateArticleWithGemini = async (event, apiKey) => {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `
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
    `,
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

  const generated = JSON.parse(response.text || '{}');
  if (!isGeneratedArticle(generated)) {
    throw new Error('Gemini returned an invalid article');
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

export const createArticleApi = ({
  apiKey,
  generateArticle = generateArticleWithGemini,
  logger = console,
}) => (
  async (request, response, next) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname !== API_PATH) {
      next();
      return;
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const body = await readJsonBody(request);
      if (!isPoliceEvent(body.event)) {
        sendJson(response, 400, { error: 'Invalid police event' });
        return;
      }

      const article = await generateArticle(body.event, apiKey);
      sendJson(response, 200, { article });
    } catch (error) {
      const statusCode = error?.statusCode === 400 || error?.statusCode === 413
        ? error.statusCode
        : 500;

      if (statusCode === 500) {
        logger.error('Article generation failed');
      }

      sendJson(response, statusCode, {
        error: statusCode === 500 ? 'Could not generate article' : error.message,
      });
    }
  }
);
