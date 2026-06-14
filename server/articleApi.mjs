import { GoogleGenAI, Type } from "@google/genai";

const MAX_REQUEST_BODY_BYTES = 1_000_000;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function generateNewsArticleFromEvent(event, apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  validatePoliceEvent(event);

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

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          lead: { type: Type.STRING },
          body: { type: Type.STRING },
          category: { type: Type.STRING },
        },
        required: ["title", "lead", "body", "category"],
      },
    },
  });

  const result = JSON.parse(response.text || "{}");
  validateArticleResult(result);

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

export async function handleGenerateArticleRequest(req, res, options = {}) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const article = await generateNewsArticleFromEvent(payload.event, options.apiKey);
    sendJson(res, 200, article);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error("Error generating news article with Gemini:", error);
    }
    sendJson(res, statusCode, {
      error: statusCode >= 500 ? "Failed to generate article" : error.message,
    });
  }
}

async function readJsonBody(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_REQUEST_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large");
    }
  }

  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function validatePoliceEvent(event) {
  if (
    !event ||
    typeof event.id !== "number" ||
    typeof event.name !== "string" ||
    typeof event.summary !== "string" ||
    typeof event.type !== "string" ||
    typeof event.datetime !== "string" ||
    !event.location ||
    typeof event.location.name !== "string"
  ) {
    throw new HttpError(400, "Request body must include a valid police event");
  }
}

function validateArticleResult(result) {
  if (
    !result ||
    typeof result.title !== "string" ||
    typeof result.lead !== "string" ||
    typeof result.body !== "string" ||
    typeof result.category !== "string"
  ) {
    throw new Error("Gemini returned an invalid article payload");
  }
}
