import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createArticleApiHandler } from "./server/articleApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const isProduction = process.env.NODE_ENV === "production";
const mode = isProduction ? "production" : "development";
const env = { ...loadLocalEnv(mode), ...process.env };
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const distDir = path.join(root, "dist");
const apiHandler = createArticleApiHandler({
  apiKey: env.GEMINI_API_KEY || env.API_KEY,
});

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

const vite = isProduction
  ? null
  : await createViteMiddlewareServer({
      root,
      appType: "spa",
      server: {
        host,
        middlewareMode: true,
      },
    });

function loadLocalEnv(currentMode) {
  const envFiles = [".env", ".env.local", `.env.${currentMode}`, `.env.${currentMode}.local`];
  const env = {};

  for (const fileName of envFiles) {
    const filePath = path.join(root, fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);

      if (!match || match[1].startsWith("#")) {
        continue;
      }

      env[match[1]] = stripEnvQuotes(match[2] ?? "");
    }
  }

  return env;
}

function stripEnvQuotes(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

async function createViteMiddlewareServer(options) {
  const { createServer: createViteServer } = await import("vite");
  return createViteServer(options);
}

const sendStaticFile = (req, res, pathname) => {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const resolvedPath = path.resolve(distDir, `.${decodedPath}`);
  const distRoot = path.resolve(distDir);

  if (!resolvedPath.startsWith(`${distRoot}${path.sep}`) && resolvedPath !== distRoot) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  const filePath = existsSync(resolvedPath) && statSync(resolvedPath).isFile()
    ? resolvedPath
    : path.join(distDir, "index.html");

  const contentType = mimeTypes.get(path.extname(filePath)) || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/api/generate-article") {
      await apiHandler(req, res);
      return;
    }

    if (!isProduction && vite) {
      vite.middlewares(req, res, () => {
        if (!res.writableEnded) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
        }
      });
      return;
    }

    sendStaticFile(req, res, requestUrl.pathname);
  } catch (error) {
    console.error("Server request error:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
