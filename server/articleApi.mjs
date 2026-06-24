import { GoogleGenAI, Type } from '@google/genai';

const JSON_LIMIT_BYTES = 1024 * 1024;

export function createArticleApiHandler({
  apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY,
  generateContent,
} = {}) {
  let ai;

  const runGeneration = generateContent || (async (request) => {
    if (!apiKey) {
      const error = new Error('GEMINI_API_KEY is not configured');
      error.statusCode = 500;
      throw error;
    }

    ai ||= new GoogleGenAI({ apiKey });
    return ai.models.generateContent(request);
  });

  return async function articleApiHandler(req, res) {
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
      return;
    }

    try {
      const { event } = await readJsonBody(req);
      validatePoliceEvent(event);

      const article = await generateArticleFromEvent(event, runGeneration);
      writeJson(res, 200, article);
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;

      if (statusCode >= 500) {
        console.error('Error generating news article with Gemini:', error);
      }

      writeJson(res, statusCode, {
        error: statusCode >= 500 ? 'Failed to generate article' : error.message,
      });
    }
  };
}

export async function generateArticleFromEvent(event, generateContent) {
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

  const response = await generateContent({
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

  const result = parseGeneratedArticle(response.text);

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
}

export function parseGeneratedArticle(text) {
  let result;

  try {
    result = JSON.parse(text || '{}');
  } catch (error) {
    const parseError = new Error('Gemini returned invalid JSON');
    parseError.statusCode = 502;
    throw parseError;
  }

  for (const field of ['title', 'lead', 'body', 'category']) {
    if (typeof result[field] !== 'string' || result[field].trim() === '') {
      const validationError = new Error(`Gemini response is missing ${field}`);
      validationError.statusCode = 502;
      throw validationError;
    }
  }

  return result;
}

async function readJsonBody(req) {
  let body = '';

  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > JSON_LIMIT_BYTES) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
  }

  try {
    return JSON.parse(body || '{}');
  } catch (error) {
    const parseError = new Error('Request body must be valid JSON');
    parseError.statusCode = 400;
    throw parseError;
  }
}

function validatePoliceEvent(event) {
  const isValid = event
    && typeof event.id === 'number'
    && typeof event.name === 'string'
    && typeof event.summary === 'string'
    && typeof event.type === 'string'
    && typeof event.datetime === 'string'
    && event.location
    && typeof event.location.name === 'string';

  if (!isValid) {
    const error = new Error('Request body must include a police event');
    error.statusCode = 400;
    throw error;
  }
}

function writeJson(res, statusCode, payload, extraHeaders = {}) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');

  for (const [name, value] of Object.entries(extraHeaders)) {
    res.setHeader(name, value);
  }

  res.end(JSON.stringify(payload));
}
