import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST_DIR = path.join(__dirname, "dist");
const MAX_BODY_BYTES = 1024 * 1024;

const articleSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    lead: { type: Type.STRING },
    body: { type: Type.STRING },
    category: { type: Type.STRING },
  },
  required: ["title", "lead", "body", "category"],
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

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

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
};

const isString = (value) => typeof value === "string" && value.length > 0;

const isPoliceEvent = (event) => {
  return (
    event &&
    typeof event === "object" &&
    typeof event.id === "number" &&
    isString(event.datetime) &&
    isString(event.name) &&
    isString(event.summary) &&
    isString(event.type) &&
    event.location &&
    typeof event.location === "object" &&
    isString(event.location.name)
  );
};

const isArticlePayload = (payload) => {
  return (
    payload &&
    typeof payload === "object" &&
    isString(payload.title) &&
    isString(payload.lead) &&
    isString(payload.body) &&
    isString(payload.category)
  );
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = "";
  let size = 0;

  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY_BYTES) {
      reject(Object.assign(new Error("Request body is too large"), { statusCode: 413 }));
      req.destroy();
      return;
    }
    body += chunk;
  });
  req.on("end", () => {
    try {
      resolve(body ? JSON.parse(body) : {});
    } catch {
      reject(Object.assign(new Error("Invalid JSON body"), { statusCode: 400 }));
    }
  });
  req.on("error", reject);
});

const generateArticle = async (ai, event) => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: buildPrompt(event),
    config: {
      responseMimeType: "application/json",
      responseSchema: articleSchema,
    },
  });

  const payload = JSON.parse(response.text || "{}");
  if (!isArticlePayload(payload)) {
    throw new Error("Gemini returned an invalid article payload");
  }

  return {
    id: `article-${event.id}-${Date.now()}`,
    originalEventId: event.id,
    title: payload.title,
    lead: payload.lead,
    body: payload.body,
    category: payload.category,
    location: event.location.name,
    timestamp: event.datetime,
    imageUrl: `https://picsum.photos/seed/${event.id}/800/450`,
  };
};

const handleGenerateArticle = async (req, res, ai) => {
  if (req.method !== "POST") {
    res.writeHead(405, {
      "Allow": "POST",
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  if (!ai) {
    sendJson(res, 500, { error: "Article generation is not configured" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    if (!isPoliceEvent(body.event)) {
      sendJson(res, 400, { error: "Invalid police event" });
      return;
    }

    const article = await generateArticle(ai, body.event);
    sendJson(res, 200, article);
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    console.error("Error generating news article with Gemini:", error);
    sendJson(res, statusCode, {
      error: statusCode === 500 ? "Failed to generate article" : error.message,
    });
  }
};

const serveStatic = async (req, res, distDir) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Allow": "GET, HEAD" });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = path.normalize(path.join(distDir, requestedPath));

  if (!filePath.startsWith(`${path.normalize(distDir)}${path.sep}`) && filePath !== path.join(distDir, "index.html")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const targetPath = existsSync(filePath) ? filePath : path.join(distDir, "index.html");

  try {
    const content = await readFile(targetPath);
    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(targetPath)] || "application/octet-stream",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
};

export const createServer = ({
  apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY,
  ai = apiKey ? new GoogleGenAI({ apiKey }) : null,
  distDir = DEFAULT_DIST_DIR,
} = {}) => {
  if (!ai) {
    console.warn("GEMINI_API_KEY is not set; article generation endpoint will return 500.");
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/api/generate-article") {
      await handleGenerateArticle(req, res, ai);
      return;
    }

    await serveStatic(req, res, distDir);
  });
};

if (isMainModule) {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  createServer().listen(port, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}
