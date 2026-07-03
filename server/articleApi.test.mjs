import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createArticleApiMiddleware, generateNewsArticle } from "./articleApi.mjs";

const event = {
  id: 123,
  datetime: "2026-07-03 10:15:00",
  name: "03 juli 10.15, Trafikolycka, Stockholm",
  summary: "En trafikolycka har inträffat på E4.",
  url: "https://polisen.se/aktuellt/handelser/2026/juli/3/03-juli-1015-trafikolycka-stockholm/",
  type: "Trafikolycka",
  location: {
    name: "Stockholm",
    gps: "59.3293,18.0686",
  },
};

const createClient = (handler) => ({
  models: {
    generateContent: handler,
  },
});

const createResponse = () => {
  const headers = new Map();
  return {
    statusCode: 200,
    headers,
    body: "",
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    end(payload) {
      this.body = payload;
    },
  };
};

const createRequest = (payload, method = "POST") => {
  const req = Readable.from([payload]);
  req.method = method;
  return req;
};

test("generateNewsArticle builds an article from a Gemini JSON response", async () => {
  let capturedRequest;
  const article = await generateNewsArticle(event, {
    now: () => 42,
    client: createClient(async (request) => {
      capturedRequest = request;
      return {
        text: JSON.stringify({
          title: "Olycka stoppar trafiken",
          lead: "En olycka påverkar trafiken på E4.",
          body: "Polisen uppger att flera fordon är inblandade.",
          category: "Trafikolycka",
        }),
      };
    }),
  });

  assert.equal(capturedRequest.model, "gemini-3-flash-preview");
  assert.match(capturedRequest.contents, /Trafikolycka, Stockholm/);
  assert.deepEqual(article, {
    id: "article-123-42",
    originalEventId: 123,
    title: "Olycka stoppar trafiken",
    lead: "En olycka påverkar trafiken på E4.",
    body: "Polisen uppger att flera fordon är inblandade.",
    category: "Trafikolycka",
    location: "Stockholm",
    timestamp: "2026-07-03 10:15:00",
    imageUrl: "https://picsum.photos/seed/123/800/450",
  });
});

test("article middleware returns generated articles as JSON", async () => {
  const middleware = createArticleApiMiddleware({
    now: () => 7,
    client: createClient(async () => ({
      text: JSON.stringify({
        title: "Rubrik",
        lead: "Ingress",
        body: "Brödtext",
        category: "Blåljus",
      }),
    })),
  });
  const req = createRequest(JSON.stringify({ event }));
  const res = createResponse();

  await middleware(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(JSON.parse(res.body).article.id, "article-123-7");
});

test("article middleware rejects invalid payloads without calling Gemini", async () => {
  let called = false;
  const middleware = createArticleApiMiddleware({
    client: createClient(async () => {
      called = true;
      return { text: "{}" };
    }),
  });
  const req = createRequest(JSON.stringify({ event: { id: 123 } }));
  const res = createResponse();

  await middleware(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
  assert.deepEqual(JSON.parse(res.body), { error: "Invalid police event payload" });
});
