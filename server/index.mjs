import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

const loadLocalEnv = () => {
  for (const filename of [".env.local", ".env"]) {
    try {
      const envFile = readFileSync(path.join(rootDir, filename), "utf8");
      for (const line of envFile.split(/\r?\n/)) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith("#")) continue;

        const separatorIndex = trimmedLine.indexOf("=");
        if (separatorIndex === -1) continue;

        const key = trimmedLine.slice(0, separatorIndex).trim();
        const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/g, "");
        if (key && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
};

loadLocalEnv();

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
const MAX_BODY_SIZE_BYTES = 1024 * 1024;

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
]);

const writeJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_SIZE_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });

const isPoliceEvent = (value) => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value;
  return (
    typeof event.id === "number" &&
    typeof event.datetime === "string" &&
    typeof event.name === "string" &&
    typeof event.summary === "string" &&
    typeof event.type === "string" &&
    event.location &&
    typeof event.location === "object" &&
    typeof event.location.name === "string"
  );
};

const generateArticle = async (event) => {
  if (!ai) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

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

  return JSON.parse(response.text || "{}");
};

const handleGenerateArticle = async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, {
      Allow: "POST",
    });
    res.end();
    return;
  }

  try {
    const { event } = await readJsonBody(req);
    if (!isPoliceEvent(event)) {
      writeJson(res, 400, { error: "Invalid police event payload" });
      return;
    }

    const article = await generateArticle(event);
    writeJson(res, 200, article);
  } catch (error) {
    console.error("Error generating news article with Gemini:", error);
    writeJson(res, 500, { error: "Failed to generate article" });
  }
};

const sendStaticFile = async (res, filePath) => {
  const content = await readFile(filePath);
  const contentType = mimeTypes.get(path.extname(filePath)) || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
  });
  res.end(content);
};

const serveStaticApp = async (req, res) => {
  const requestUrl = new URL(req.url || "/", "http://localhost");
  const decodedPathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = decodedPathname === "/" ? "index.html" : decodedPathname.slice(1);
  const requestedFile = path.resolve(distDir, relativePath);
  const relativeToDist = path.relative(distDir, requestedFile);

  if (relativeToDist.startsWith("..") || path.isAbsolute(relativeToDist)) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    const fileStat = await stat(requestedFile);
    if (fileStat.isFile()) {
      await sendStaticFile(res, requestedFile);
      return;
    }
  } catch {
    // Fall through to the SPA entry point.
  }

  await sendStaticFile(res, path.join(distDir, "index.html"));
};

const vite = isProduction
  ? null
  : await createViteServer({
      root: rootDir,
      server: {
        middlewareMode: true,
      },
      appType: "spa",
    });

const server = createHttpServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", "http://localhost");

  if (requestUrl.pathname === "/api/generate-news-article") {
    await handleGenerateArticle(req, res);
    return;
  }

  if (vite) {
    vite.middlewares(req, res, () => {
      res.writeHead(404);
      res.end();
    });
    return;
  }

  try {
    await serveStaticApp(req, res);
  } catch (error) {
    console.error("Error serving app:", error);
    res.writeHead(500);
    res.end();
  }
});

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
