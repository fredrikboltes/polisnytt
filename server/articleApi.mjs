import { GoogleGenAI, Type } from '@google/genai';

const ARTICLE_PATH = '/api/generate-article';

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

const readJsonBody = async (req) => {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const isValidPoliceEvent = (event) => (
  event &&
  typeof event.id === 'number' &&
  typeof event.datetime === 'string' &&
  typeof event.name === 'string' &&
  typeof event.summary === 'string' &&
  typeof event.type === 'string' &&
  event.location &&
  typeof event.location.name === 'string'
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

const buildResponseSchema = () => ({
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    lead: { type: Type.STRING },
    body: { type: Type.STRING },
    category: { type: Type.STRING },
  },
  required: ['title', 'lead', 'body', 'category'],
});

const assertGeneratedArticle = (article) => {
  if (
    !article ||
    typeof article.title !== 'string' ||
    typeof article.lead !== 'string' ||
    typeof article.body !== 'string' ||
    typeof article.category !== 'string'
  ) {
    throw new Error('Gemini returned an invalid article payload');
  }
};

export const createArticleApiHandler = ({ apiKey, GoogleGenAIClass = GoogleGenAI } = {}) => {
  const ai = apiKey ? new GoogleGenAIClass({ apiKey }) : null;

  return async (req, res, next) => {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');

    if (requestUrl.pathname !== ARTICLE_PATH) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (!ai) {
      sendJson(res, 500, { error: 'GEMINI_API_KEY is not configured' });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const event = body?.event;

      if (!isValidPoliceEvent(event)) {
        sendJson(res, 400, { error: 'Invalid police event payload' });
        return;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: buildPrompt(event),
        config: {
          responseMimeType: 'application/json',
          responseSchema: buildResponseSchema(),
        },
      });

      const generatedArticle = JSON.parse(response.text || '{}');
      assertGeneratedArticle(generatedArticle);

      sendJson(res, 200, {
        id: `article-${event.id}-${Date.now()}`,
        originalEventId: event.id,
        title: generatedArticle.title,
        lead: generatedArticle.lead,
        body: generatedArticle.body,
        category: generatedArticle.category,
        location: event.location.name,
        timestamp: event.datetime,
        imageUrl: `https://picsum.photos/seed/${event.id}/800/450`,
      });
    } catch (error) {
      console.error('Error generating news article with Gemini:', error);
      sendJson(res, 500, { error: 'Failed to generate article' });
    }
  };
};

