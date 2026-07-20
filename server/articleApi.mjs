import { GoogleGenAI, Type } from '@google/genai';

const POLICE_EVENTS_URL = 'https://polisen.se/api/events';
const COUNTIES = new Set([
  'Blekinge', 'Dalarna', 'Gotland', 'Gävleborg', 'Halland',
  'Jämtland', 'Jönköping', 'Kalmar', 'Kronoberg', 'Norrbotten',
  'Skåne', 'Stockholm', 'Södermanland', 'Uppsala', 'Värmland',
  'Västerbotten', 'Västernorrland', 'Västmanland', 'Västra Götaland',
  'Örebro', 'Östergötland',
]);

const JSON_LIMIT = 1024;
const EVENT_CACHE_TTL = 60_000;
const ARTICLE_CACHE_TTL = 30 * 60_000;
const RATE_WINDOW = 60_000;
const RATE_LIMIT = 10;
const MAX_CACHE_ENTRIES = 500;
const MAX_RATE_CLIENTS = 1000;

const sendJson = (response, status, payload) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
};

const readJson = async (request) => {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT) {
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 });
  }
};

const isPrivateAddress = (address) => {
  const value = address?.replace(/^::ffff:/, '') ?? '';
  if (value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) {
    return true;
  }

  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
};

const getClientAddress = (request) => {
  const peer = request.socket?.remoteAddress ?? 'unknown';
  if (!isPrivateAddress(peer)) return peer;

  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string') return peer;

  const addresses = forwarded.split(',').map(value => value.trim()).filter(Boolean);
  for (let index = addresses.length - 1; index >= 0; index -= 1) {
    if (!isPrivateAddress(addresses[index])) return addresses[index];
  }

  return addresses[0] ?? peer;
};

const isPoliceEvent = (event) => (
  event
  && Number.isInteger(event.id)
  && typeof event.datetime === 'string'
  && typeof event.name === 'string'
  && typeof event.summary === 'string'
  && typeof event.type === 'string'
  && typeof event.location?.name === 'string'
);

const trimMap = (map, maximum) => {
  while (map.size > maximum) {
    map.delete(map.keys().next().value);
  }
};

export const generateArticleWithGemini = async (event, apiKey) => {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

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

  const result = JSON.parse(response.text || '{}');
  if (!['title', 'lead', 'body', 'category'].every(field => typeof result[field] === 'string' && result[field].trim())) {
    throw new Error('Gemini returned an invalid article');
  }

  return {
    id: `article-${event.id}`,
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

export const createArticleApi = ({
  apiKey = process.env.GEMINI_API_KEY,
  fetchImpl = globalThis.fetch,
  generateArticle = generateArticleWithGemini,
  now = Date.now,
} = {}) => {
  const eventCache = new Map();
  const eventRequests = new Map();
  const articleCache = new Map();
  const articleRequests = new Map();
  const rateClients = new Map();

  const fetchCountyEvents = async (county) => {
    const cached = eventCache.get(county);
    if (cached && cached.expiresAt > now()) return cached.events;
    if (eventRequests.has(county)) return eventRequests.get(county);

    const request = (async () => {
      const url = new URL(POLICE_EVENTS_URL);
      url.searchParams.set('locationname', county);
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`Police API returned ${response.status}`);
      const events = await response.json();
      if (!Array.isArray(events)) throw new Error('Police API returned invalid data');
      const validEvents = events.filter(isPoliceEvent);
      eventCache.set(county, { events: validEvents, expiresAt: now() + EVENT_CACHE_TTL });
      trimMap(eventCache, COUNTIES.size);
      return validEvents;
    })();

    eventRequests.set(county, request);
    try {
      return await request;
    } finally {
      eventRequests.delete(county);
    }
  };

  const consumeRateLimit = (client) => {
    const timestamp = now();
    let entry = rateClients.get(client);
    if (!entry || timestamp - entry.windowStartedAt >= RATE_WINDOW) {
      entry = { count: 0, windowStartedAt: timestamp };
    }
    entry.count += 1;
    rateClients.delete(client);
    rateClients.set(client, entry);
    trimMap(rateClients, MAX_RATE_CLIENTS);
    return entry.count <= RATE_LIMIT;
  };

  return async (request, response, next) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/api/generate-article') {
      next();
      return;
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const body = await readJson(request);
      if (!Number.isInteger(body?.eventId) || body.eventId <= 0 || !COUNTIES.has(body?.county)) {
        sendJson(response, 400, { error: 'A valid eventId and county are required' });
        return;
      }

      const cached = articleCache.get(body.eventId);
      if (cached && cached.expiresAt > now()) {
        sendJson(response, 200, cached.article);
        return;
      }
      if (cached) articleCache.delete(body.eventId);

      let pending = articleRequests.get(body.eventId);
      if (!pending) {
        const events = await fetchCountyEvents(body.county);
        const event = events.find(candidate => candidate.id === body.eventId);
        if (!event) {
          sendJson(response, 404, { error: 'Police event not found' });
          return;
        }

        pending = articleRequests.get(body.eventId);
        if (!pending) {
          if (!consumeRateLimit(getClientAddress(request))) {
            sendJson(response, 429, { error: 'Too many requests' });
            return;
          }

          pending = generateArticle(event, apiKey).then(article => {
            articleCache.set(body.eventId, { article, expiresAt: now() + ARTICLE_CACHE_TTL });
            trimMap(articleCache, MAX_CACHE_ENTRIES);
            return article;
          });
          articleRequests.set(body.eventId, pending);
        }
      }

      try {
        sendJson(response, 200, await pending);
      } finally {
        if (articleRequests.get(body.eventId) === pending) {
          articleRequests.delete(body.eventId);
        }
      }
    } catch (error) {
      console.error('Article API request failed:', error);
      sendJson(response, error?.statusCode ?? 502, {
        error: error?.statusCode ? error.message : 'Unable to generate article',
      });
    }
  };
};
