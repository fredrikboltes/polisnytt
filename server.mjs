import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3000;
const app = express();

config({ path: ['.env.local', '.env'] });

app.use(express.json({ limit: '32kb' }));

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('GEMINI_API_KEY is not set; article generation will fail until it is configured.');
}

const ai = new GoogleGenAI({ apiKey: apiKey || '' });

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const parsePoliceEvent = (value) => {
  if (!value || typeof value !== 'object') return null;

  const event = value;
  if (
    typeof event.id !== 'number' ||
    !isNonEmptyString(event.datetime) ||
    !isNonEmptyString(event.name) ||
    !isNonEmptyString(event.summary) ||
    !isNonEmptyString(event.type) ||
    !event.location ||
    typeof event.location !== 'object' ||
    !isNonEmptyString(event.location.name)
  ) {
    return null;
  }

  return event;
};

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

app.post('/api/articles/generate', async (req, res) => {
  if (!apiKey) {
    res.status(500).json({ error: 'Article generation is not configured.' });
    return;
  }

  const event = parsePoliceEvent(req.body?.event);
  if (!event) {
    res.status(400).json({ error: 'Invalid police event payload.' });
    return;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: buildPrompt(event),
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
    if (
      !isNonEmptyString(result.title) ||
      !isNonEmptyString(result.lead) ||
      !isNonEmptyString(result.body) ||
      !isNonEmptyString(result.category)
    ) {
      throw new Error('Gemini response did not include a complete article.');
    }

    res.json({
      id: `article-${event.id}-${Date.now()}`,
      originalEventId: event.id,
      title: result.title,
      lead: result.lead,
      body: result.body,
      category: result.category,
      location: event.location.name,
      timestamp: event.datetime,
      imageUrl: `https://picsum.photos/seed/${event.id}/800/450`,
    });
  } catch (error) {
    console.error('Error generating news article with Gemini:', error);
    res.status(502).json({ error: 'Failed to generate article.' });
  }
});

if (isProduction) {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});
