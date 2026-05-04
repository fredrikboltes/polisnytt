import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(__dirname, "dist");
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY must be set before starting the server.");
}

const ai = new GoogleGenAI({ apiKey });

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const isPoliceEvent = (value) =>
  value &&
  typeof value.id === "number" &&
  typeof value.datetime === "string" &&
  typeof value.name === "string" &&
  typeof value.summary === "string" &&
  typeof value.type === "string" &&
  value.location &&
  typeof value.location.name === "string";

const readJsonBody = async (request) => {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) {
      throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    }
  }

  return JSON.parse(body || "{}");
};

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
};

const generateNewsArticle = async (event) => {
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

  if (
    typeof result.title !== "string" ||
    typeof result.lead !== "string" ||
    typeof result.body !== "string" ||
    typeof result.category !== "string"
  ) {
    throw new Error("Gemini returned an invalid article payload.");
  }

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

const handleGenerateArticle = async (request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end();
    return;
  }

  try {
    const { event } = await readJsonBody(request);

    if (!isPoliceEvent(event)) {
      sendJson(response, 400, { error: "Invalid police event." });
      return;
    }

    sendJson(response, 200, await generateNewsArticle(event));
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: "Invalid JSON." });
      return;
    }

    const statusCode = error.statusCode || 500;
    console.error("Error generating news article with Gemini:", error);
    sendJson(response, statusCode, { error: "Failed to generate article." });
  }
};

const serveIndex = async (response) => {
  const index = await readFile(resolve(distDir, "index.html"));
  response.writeHead(200, { "Content-Type": mimeTypes[".html"] });
  response.end(index);
};

const serveStaticAsset = async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(distDir, requestedPath));

  if (filePath !== distDir && !filePath.startsWith(`${distDir}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    });
    response.end(data);
  } catch (error) {
    if (extname(requestedPath)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    await serveIndex(response);
  }
};

createServer((request, response) => {
  if (request.url?.startsWith("/api/generate-article")) {
    void handleGenerateArticle(request, response);
    return;
  }

  void serveStaticAsset(request, response);
}).listen(port, "0.0.0.0", () => {
  console.log(`Polisnyheter server listening on port ${port}`);
});
