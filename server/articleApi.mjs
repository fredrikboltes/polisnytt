const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_MODEL = "gemini-3-flash-preview";

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const isPoliceEvent = (value) => {
  return Boolean(
    value &&
      typeof value.id === "number" &&
      isNonEmptyString(value.datetime) &&
      isNonEmptyString(value.name) &&
      isNonEmptyString(value.summary) &&
      isNonEmptyString(value.type) &&
      value.location &&
      isNonEmptyString(value.location.name)
  );
};

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const readJsonBody = async (req) => {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
  }

  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
};

const parseGeminiResponse = (response) => {
  const text = typeof response.text === "function" ? response.text() : response.text;
  const result = JSON.parse(text || "{}");

  if (
    !isNonEmptyString(result.title) ||
    !isNonEmptyString(result.lead) ||
    !isNonEmptyString(result.body) ||
    !isNonEmptyString(result.category)
  ) {
    throw new Error("Gemini response did not include a complete article");
  }

  return result;
};

const createGeminiClient = async (apiKey) => {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const { GoogleGenAI } = await import("@google/genai");
  return new GoogleGenAI({ apiKey });
};

export const generateNewsArticle = async (event, options = {}) => {
  if (!isPoliceEvent(event)) {
    throw new Error("Invalid police event payload");
  }

  const ai = options.client ?? (await createGeminiClient(options.apiKey));
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
    model: options.model ?? DEFAULT_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          lead: { type: "string" },
          body: { type: "string" },
          category: { type: "string" },
        },
        required: ["title", "lead", "body", "category"],
      },
    },
  });

  const result = parseGeminiResponse(response);

  return {
    id: `article-${event.id}-${options.now?.() ?? Date.now()}`,
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

export const createArticleApiMiddleware = (options = {}) => {
  return async (req, res, next) => {
    if (req.method !== "POST") {
      if (next) {
        next();
        return;
      }
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await readJsonBody(req);
      if (!isPoliceEvent(body.event)) {
        sendJson(res, 400, { error: "Invalid police event payload" });
        return;
      }

      const article = await generateNewsArticle(body.event, options);
      sendJson(res, 200, { article });
    } catch (error) {
      const statusCode = error.statusCode ?? (error.message === "GEMINI_API_KEY is not configured" ? 500 : 502);
      console.error("Error generating article:", error);
      sendJson(res, statusCode, { error: "Failed to generate article" });
    }
  };
};
