import { GoogleGenAI, Type } from '@google/genai';

const API_PATH = '/api/generate-article';
const MAX_BODY_BYTES = 64 * 1024;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

const readJsonBody = async (req) => {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new RequestError(413, 'Request body is too large');
  }

  const chunks = [];
  let size = 0;
  let tooLarge = false;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
    } else if (!tooLarge) {
      chunks.push(chunk);
    }
  }

  if (tooLarge) {
    throw new RequestError(413, 'Request body is too large');
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Request body must be valid JSON');
  }
};

const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

const isPoliceEvent = (event) =>
  event !== null &&
  typeof event === 'object' &&
  Number.isInteger(event.id) &&
  isNonEmptyString(event.datetime) &&
  isNonEmptyString(event.name) &&
  isNonEmptyString(event.summary) &&
  isNonEmptyString(event.type) &&
  event.location !== null &&
  typeof event.location === 'object' &&
  isNonEmptyString(event.location.name);

const isGeneratedArticle = (article) =>
  article !== null &&
  typeof article === 'object' &&
  isNonEmptyString(article.title) &&
  isNonEmptyString(article.lead) &&
  isNonEmptyString(article.body) &&
  isNonEmptyString(article.category);

const createPrompt = (event) => `
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

const generationRequest = (event) => ({
  model: 'gemini-3-flash-preview',
  contents: createPrompt(event),
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

export const createArticleApiMiddleware = ({
  apiKey,
  generateContent: generateContentOverride,
} = {}) => {
  let client;
  const generateContent =
    generateContentOverride ||
    ((request) => {
      client ||= new GoogleGenAI({ apiKey });
      return client.models.generateContent(request);
    });

  return async (req, res, next) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname !== API_PATH) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (!apiKey && !generateContentOverride) {
      sendJson(res, 503, { error: 'Article generation is not configured' });
      return;
    }

    try {
      const body = await readJsonBody(req);
      if (!isPoliceEvent(body?.event)) {
        throw new RequestError(400, 'A valid police event is required');
      }

      const response = await generateContent(generationRequest(body.event));
      let generated;
      try {
        generated = JSON.parse(response.text || '');
      } catch {
        throw new Error('Provider returned invalid JSON');
      }

      if (!isGeneratedArticle(generated)) {
        throw new Error('Provider returned an invalid article');
      }

      sendJson(res, 200, {
        id: `article-${body.event.id}-${Date.now()}`,
        originalEventId: body.event.id,
        title: generated.title,
        lead: generated.lead,
        body: generated.body,
        category: generated.category,
        location: body.event.location.name,
        timestamp: body.event.datetime,
        imageUrl: `https://picsum.photos/seed/${body.event.id}/800/450`,
      });
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }

      console.error('Article generation failed');
      sendJson(res, 502, { error: 'Article generation failed' });
    }
  };
};

export const articleApiPlugin = (apiKey) => {
  const installMiddleware = (server) => {
    server.middlewares.use(createArticleApiMiddleware({ apiKey }));
  };

  return {
    name: 'article-api',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
};
