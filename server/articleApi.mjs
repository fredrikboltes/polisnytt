import { GoogleGenAI, Type } from '@google/genai';

const API_PATH = '/api/generate-article';
const MAX_BODY_BYTES = 64 * 1024;
const POLICE_EVENTS_URL = 'https://polisen.se/api/events';
const CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 1000;
const MAX_CACHED_ARTICLES = 1000;

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

const fetchCurrentPoliceEvents = async () => {
  const response = await fetch(POLICE_EVENTS_URL);
  if (!response.ok) {
    throw new Error(`Police API returned status ${response.status}`);
  }

  const events = await response.json();
  if (!Array.isArray(events)) {
    throw new Error('Police API returned an invalid response');
  }

  return events.filter(isPoliceEvent);
};

export const createArticleApiMiddleware = ({
  apiKey,
  generateContent: generateContentOverride,
  fetchPoliceEvents = fetchCurrentPoliceEvents,
  now = Date.now,
} = {}) => {
  let client;
  let policeEvents = [];
  let policeEventsExpireAt = 0;
  let policeEventsPromise;
  const articleCache = new Map();
  const inFlightArticles = new Map();
  const rateLimits = new Map();
  const generateContent =
    generateContentOverride ||
    ((request) => {
      client ||= new GoogleGenAI({ apiKey });
      return client.models.generateContent(request);
    });

  const findPoliceEvent = async (eventId) => {
    if (now() >= policeEventsExpireAt) {
      policeEventsPromise ||= Promise.resolve(fetchPoliceEvents())
        .then(events => {
          if (!Array.isArray(events)) {
            throw new Error('Police API returned an invalid response');
          }
          policeEvents = events.filter(isPoliceEvent);
          policeEventsExpireAt = now() + CACHE_TTL_MS;
        })
        .finally(() => {
          policeEventsPromise = undefined;
        });
      await policeEventsPromise;
    }
    return policeEvents.find(event => event.id === eventId);
  };

  const isRateLimited = (req) => {
    const currentTime = now();
    const clientAddress = req.socket.remoteAddress || 'unknown';
    const current = rateLimits.get(clientAddress);

    if (!current || current.resetAt <= currentTime) {
      if (rateLimits.size >= MAX_TRACKED_CLIENTS) {
        for (const [address, limit] of rateLimits) {
          if (limit.resetAt <= currentTime) rateLimits.delete(address);
        }
        if (rateLimits.size >= MAX_TRACKED_CLIENTS) {
          rateLimits.delete(rateLimits.keys().next().value);
        }
      }
      rateLimits.set(clientAddress, { count: 1, resetAt: currentTime + RATE_WINDOW_MS });
      return false;
    }

    if (current.count >= RATE_LIMIT) return true;
    current.count++;
    return false;
  };

  const cacheArticle = (eventId, article) => {
    const currentTime = now();
    if (articleCache.size >= MAX_CACHED_ARTICLES) {
      for (const [cachedId, cached] of articleCache) {
        if (cached.expiresAt <= currentTime) articleCache.delete(cachedId);
      }
      if (articleCache.size >= MAX_CACHED_ARTICLES) {
        articleCache.delete(articleCache.keys().next().value);
      }
    }
    articleCache.set(eventId, { article, expiresAt: currentTime + CACHE_TTL_MS });
  };

  const generateArticle = async (event) => {
    const response = await generateContent(generationRequest(event));
    let generated;
    try {
      generated = JSON.parse(response.text || '');
    } catch {
      throw new Error('Provider returned invalid JSON');
    }

    if (!isGeneratedArticle(generated)) {
      throw new Error('Provider returned an invalid article');
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
      if (!Number.isInteger(body?.eventId)) {
        throw new RequestError(400, 'A valid police event ID is required');
      }

      const cached = articleCache.get(body.eventId);
      if (cached && cached.expiresAt > now()) {
        sendJson(res, 200, cached.article);
        return;
      }
      if (cached) articleCache.delete(body.eventId);

      const event = await findPoliceEvent(body.eventId);
      if (!event) {
        throw new RequestError(404, 'Police event was not found');
      }

      let articlePromise = inFlightArticles.get(event.id);
      if (!articlePromise) {
        if (isRateLimited(req)) {
          throw new RequestError(429, 'Too many article generation requests');
        }
        articlePromise = generateArticle(event);
        inFlightArticles.set(event.id, articlePromise);
      }

      try {
        const article = await articlePromise;
        cacheArticle(event.id, article);
        sendJson(res, 200, article);
      } finally {
        if (inFlightArticles.get(event.id) === articlePromise) {
          inFlightArticles.delete(event.id);
        }
      }
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
