import { GoogleGenAI, Type } from '@google/genai';

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    lead: { type: Type.STRING },
    body: { type: Type.STRING },
    category: { type: Type.STRING },
  },
  required: ['title', 'lead', 'body', 'category'],
};

export const buildArticlePrompt = (event) => `
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

const hasRequiredArticleFields = (value) => (
  value
  && typeof value.title === 'string'
  && typeof value.lead === 'string'
  && typeof value.body === 'string'
  && typeof value.category === 'string'
);

export const createNewsArticle = (event, generated, now = Date.now()) => {
  if (!hasRequiredArticleFields(generated)) {
    throw new Error('Gemini returned an invalid article payload');
  }

  return {
    id: `article-${event.id}-${now}`,
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

export const createGeminiArticleGenerator = (apiKey) => {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to generate articles');
  }

  const ai = new GoogleGenAI({ apiKey });

  return async (event) => {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: buildArticlePrompt(event),
      config: {
        responseMimeType: 'application/json',
        responseSchema,
      },
    });

    const generated = JSON.parse(response.text || '{}');
    return createNewsArticle(event, generated);
  };
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      resolve(body ? JSON.parse(body) : {});
    } catch (error) {
      reject(new Error('Invalid JSON request body'));
    }
  });
  req.on('error', reject);
});

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

const isPoliceEvent = (value) => (
  value
  && typeof value.id === 'number'
  && typeof value.datetime === 'string'
  && typeof value.name === 'string'
  && typeof value.summary === 'string'
  && typeof value.type === 'string'
  && value.location
  && typeof value.location.name === 'string'
);

export const createArticleApiHandler = ({ apiKey, generateArticle } = {}) => {
  let generator = generateArticle;

  return async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    let event;
    try {
      const body = await readJsonBody(req);
      event = body.event;
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }

    if (!isPoliceEvent(event)) {
      sendJson(res, 400, { error: 'A valid police event is required' });
      return;
    }

    try {
      generator ||= createGeminiArticleGenerator(apiKey);
      const article = await generator(event);
      sendJson(res, 200, { article });
    } catch (error) {
      console.error('Error generating news article with Gemini:', error);
      sendJson(res, 500, { error: 'Could not generate article' });
    }
  };
};
