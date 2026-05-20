import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);

const ARTICLE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    lead: { type: Type.STRING },
    body: { type: Type.STRING },
    category: { type: Type.STRING },
  },
  required: ['title', 'lead', 'body', 'category']
};

loadEnvFile('.env');
loadEnvFile('.env.local');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/api/generate-article', async (req, res) => {
  const event = req.body?.event;
  if (!isPoliceEvent(event)) {
    res.status(400).json({ error: 'Invalid police event payload' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Gemini API key is not configured' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: buildPrompt(event),
      config: {
        responseMimeType: 'application/json',
        responseSchema: ARTICLE_SCHEMA,
      },
    });

    const generated = JSON.parse(response.text || '{}');
    if (!isGeneratedArticle(generated)) {
      res.status(502).json({ error: 'Gemini returned an invalid article' });
      return;
    }

    res.json({
      id: `article-${event.id}-${Date.now()}`,
      originalEventId: event.id,
      title: generated.title,
      lead: generated.lead,
      body: generated.body,
      category: generated.category,
      location: event.location.name,
      timestamp: event.datetime,
      imageUrl: `https://picsum.photos/seed/${event.id}/800/450`
    });
  } catch (error) {
    console.error('Error generating news article with Gemini:', error);
    res.status(502).json({ error: 'Failed to generate news article' });
  }
});

if (isProduction) {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.use((_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});

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

function isPoliceEvent(event) {
  return Boolean(
    event &&
    typeof event.id === 'number' &&
    typeof event.datetime === 'string' &&
    typeof event.name === 'string' &&
    typeof event.summary === 'string' &&
    typeof event.type === 'string' &&
    event.location &&
    typeof event.location.name === 'string'
  );
}

function isGeneratedArticle(article) {
  return Boolean(
    article &&
    typeof article.title === 'string' &&
    typeof article.lead === 'string' &&
    typeof article.body === 'string' &&
    typeof article.category === 'string'
  );
}

function loadEnvFile(fileName) {
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;

    const key = match[1];
    if (process.env[key] !== undefined) continue;

    let value = match[2] || '';
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
