import { GoogleGenAI, Type } from '@google/genai';

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_MODEL = 'gemini-3-flash-preview';

export function createArticleApiHandler({ apiKey, model = DEFAULT_MODEL } = {}) {
  let ai = null;

  return async function handleGenerateArticle(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
      return;
    }

    if (!apiKey) {
      console.error('GEMINI_API_KEY is not configured');
      sendJson(res, 500, { error: 'Article generation is not configured' });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const event = validatePoliceEvent(body?.event);

      if (!ai) {
        ai = new GoogleGenAI({ apiKey });
      }

      const article = await generateArticle(ai, model, event);
      sendJson(res, 200, article);
    } catch (error) {
      const statusCode = error instanceof RequestError ? error.statusCode : 502;
      if (!(error instanceof RequestError)) {
        console.error('Error generating news article with Gemini:', error);
      }
      sendJson(res, statusCode, { error: statusCode === 400 ? error.message : 'Article generation failed' });
    }
  };
}

async function generateArticle(ai, model, event) {
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
    model,
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

  const result = JSON.parse(response.text || '{}');
  assertGeneratedArticle(result);

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

function validatePoliceEvent(event) {
  if (
    !event ||
    typeof event.id !== 'number' ||
    typeof event.datetime !== 'string' ||
    typeof event.name !== 'string' ||
    typeof event.summary !== 'string' ||
    typeof event.type !== 'string' ||
    !event.location ||
    typeof event.location.name !== 'string'
  ) {
    throw new RequestError(400, 'Invalid police event');
  }

  return event;
}

function assertGeneratedArticle(result) {
  if (
    !result ||
    typeof result.title !== 'string' ||
    typeof result.lead !== 'string' ||
    typeof result.body !== 'string' ||
    typeof result.category !== 'string'
  ) {
    throw new Error('Gemini returned an invalid article payload');
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new RequestError(400, 'Request body is too large');
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new RequestError(400, 'Invalid JSON body');
  }
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
