import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createArticleApiHandler } from "./articleApi.mjs";

const event = {
  id: 123,
  datetime: "2026-06-18 10:15",
  name: "18 juni 10.15, Trafikolycka, Stockholm",
  summary: "Polis larmas till en trafikolycka.",
  url: "https://polisen.se/aktuellt/handelser/2026/juni/18/18-juni-1015-trafikolycka-stockholm/",
  type: "Trafikolycka",
  location: {
    name: "Stockholm",
    gps: "59.3293,18.0686",
  },
};

const withServer = async (handler, callback) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

test("article API returns generated articles for valid police events", async () => {
  const expectedArticle = {
    id: "article-123-test",
    originalEventId: 123,
    title: "Trafikolycka i Stockholm",
    lead: "En trafikolycka har inträffat i Stockholm.",
    body: "Polisen arbetar på platsen.",
    category: "Trafikolycka",
    location: "Stockholm",
    timestamp: "2026-06-18 10:15",
    imageUrl: "https://picsum.photos/seed/123/800/450",
  };

  let receivedEvent;
  const handler = createArticleApiHandler({
    apiKey: "server-only-key",
    generateArticle: async (policeEvent) => {
      receivedEvent = policeEvent;
      return expectedArticle;
    },
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expectedArticle);
  });

  assert.deepEqual(receivedEvent, event);
});

test("article API rejects malformed police events before generation", async () => {
  let generatorCalled = false;
  const handler = createArticleApiHandler({
    apiKey: "server-only-key",
    generateArticle: async () => {
      generatorCalled = true;
      throw new Error("should not be called");
    },
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: 123 }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Request body is missing required police event fields.",
    });
  });

  assert.equal(generatorCalled, false);
});

test("article API does not allow non-POST requests", async () => {
  const handler = createArticleApiHandler({
    apiKey: "server-only-key",
    generateArticle: async () => {
      throw new Error("should not be called");
    },
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(baseUrl);

    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  });
});
