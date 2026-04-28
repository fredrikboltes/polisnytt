import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('GEMINI_API_KEY must be set before starting the server.');
}

const ai = new GoogleGenAI({ apiKey });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, 'dist');

const isPoliceEvent = (value) => {
  if (!value || typeof value !== 'object') return false;

  return (
    typeof value.id === 'number' &&
    typeof value.datetime === 'string' &&
    typeof value.name === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.type === 'string' &&
    !!value.location &&
    typeof value.location.name === 'string'
  );
};

app.use(express.json({ limit: '64kb' }));

app.post('/api/generate-news-article', async (req, res) => {
  const event = req.body?.event;
  if (!isPoliceEvent(event)) {
    res.status(400).json({ error: 'Invalid police event payload.' });
    return;
  }

  try {
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

    const result = JSON.parse(response.text || '{}');

    if (
      typeof result.title !== 'string' ||
      typeof result.lead !== 'string' ||
      typeof result.body !== 'string' ||
      typeof result.category !== 'string'
    ) {
      throw new Error('Gemini returned an incomplete article payload.');
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
    res.status(502).json({ error: 'Failed to generate news article.' });
  }
});

app.use(express.static(distPath));

app.use((_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`Polisnyheter server listening on port ${port}`);
});
