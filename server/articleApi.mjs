import { GoogleGenAI, Type } from "@google/genai";

const MAX_BODY_BYTES = 1_000_000;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const validatePoliceEvent = (event) => {
  if (!isObject(event)) {
    throw new HttpError(400, "Request body must be a police event object.");
  }

  if (
    typeof event.id !== "number" ||
    typeof event.datetime !== "string" ||
    typeof event.name !== "string" ||
    typeof event.summary !== "string" ||
    typeof event.type !== "string" ||
    !isObject(event.location) ||
    typeof event.location.name !== "string"
  ) {
    throw new HttpError(400, "Request body is missing required police event fields.");
  }
};

const validateGeneratedArticle = (article) => {
  if (
    !isObject(article) ||
    typeof article.title !== "string" ||
    typeof article.lead !== "string" ||
    typeof article.body !== "string" ||
    typeof article.category !== "string"
  ) {
    throw new Error("Gemini returned an invalid article payload.");
  }
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    let rejected = false;
    const chunks = [];

    req.on("data", (chunk) => {
      if (rejected) {
        return;
      }

      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        rejected = true;
        reject(new HttpError(413, "Request body is too large."));
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (rejected) {
        return;
      }

      try {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(rawBody || "{}"));
      } catch {
        reject(new HttpError(400, "Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
};

export const generateNewsArticle = async (ai, event) => {
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
  validateGeneratedArticle(result);

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
};

export const createArticleApiHandler = ({ apiKey, generateArticle } = {}) => {
  const articleGenerator = generateArticle ?? (async (event) => {
    if (!apiKey) {
      throw new HttpError(500, "Gemini API key is not configured.");
    }

    const ai = new GoogleGenAI({ apiKey });
    return generateNewsArticle(ai, event);
  });

  return async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, {
        Allow: "POST",
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({ error: "Method not allowed." }));
      return;
    }

    try {
      const event = await readJsonBody(req);
      validatePoliceEvent(event);

      const article = await articleGenerator(event);
      sendJson(res, 200, article);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const message = statusCode >= 500 ? "Article generation failed." : error.message;

      if (statusCode >= 500) {
        console.error("Article generation API error:", error);
      }

      sendJson(res, statusCode, { error: message });
    }
  };
};
