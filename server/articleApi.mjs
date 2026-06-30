import { GoogleGenAI, Type } from '@google/genai';

const MODEL = 'gemini-3-flash-preview';
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

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Request body must be valid JSON'));
      }
    });
  });
}

function isValidEvent(event) {
  return Boolean(
    event &&
      typeof event.id === 'number' &&
      typeof event.name === 'string' &&
      typeof event.summary === 'string' &&
      typeof event.type === 'string' &&
      typeof event.datetime === 'string' &&
      event.location &&
      typeof event.location.name === 'string',
  );
}

function buildPrompt(event) {
  return `
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
}

function parseArticle(text) {
  const article = JSON.parse(text || '{}');
  if (
    typeof article.title !== 'string' ||
    typeof article.lead !== 'string' ||
    typeof article.body !== 'string' ||
    typeof article.category !== 'string'
  ) {
    throw new Error('Gemini returned an incomplete article');
  }
  return article;
}

export function createGenerateArticleHandler({
  apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY,
  GoogleGenAIImpl = GoogleGenAI,
  logger = console,
  now = () => Date.now(),
} = {}) {
  let ai;

  return async function generateArticleHandler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (!apiKey) {
      sendJson(res, 500, { error: 'Gemini API key is not configured' });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }

    const event = body.event;
    if (!isValidEvent(event)) {
      sendJson(res, 400, { error: 'Request body must include a valid police event' });
      return;
    }

    try {
      ai ??= new GoogleGenAIImpl({ apiKey });
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(event),
        config: {
          responseMimeType: 'application/json',
          responseSchema: articleSchema,
        },
      });
      const generated = parseArticle(response.text);

      sendJson(res, 200, {
        article: {
          id: `article-${event.id}-${now()}`,
          originalEventId: event.id,
          title: generated.title,
          lead: generated.lead,
          body: generated.body,
          category: generated.category,
          location: event.location.name,
          timestamp: event.datetime,
          imageUrl: `https://picsum.photos/seed/${event.id}/800/450`,
        },
      });
    } catch (error) {
      logger.error('Error generating news article with Gemini:', error);
      sendJson(res, 502, { error: 'Failed to generate article' });
    }
  };
}
