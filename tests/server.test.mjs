import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../server.mjs";

const sampleEvent = {
  id: 123,
  datetime: "2026-05-13 11:02:00 +02:00",
  name: "Trafikolycka, Stockholm",
  summary: "Två bilar har kolliderat på E4.",
  url: "https://polisen.se/aktuellt/handelser/123/",
  type: "Trafikolycka",
  location: {
    name: "Stockholm",
    gps: "59.3293,18.0686",
  },
};

const jsonFetch = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  return {
    response,
    payload: await response.json(),
  };
};

test("generate article endpoint returns a news article without requiring a client API key", async () => {
  let receivedPrompt = "";
  const ai = {
    models: {
      async generateContent(request) {
        receivedPrompt = request.contents;
        return {
          text: JSON.stringify({
            title: "Kollision på E4 i Stockholm",
            lead: "Två bilar kolliderade på E4 under förmiddagen.",
            body: "Polisen rapporterar att olyckan inträffade i Stockholm.",
            category: "Trafikolycka",
          }),
        };
      },
    },
  };
  const server = createServer({ ai });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    const { response, payload } = await jsonFetch(`http://127.0.0.1:${address.port}/api/generate-article`, {
      method: "POST",
      body: JSON.stringify({ event: sampleEvent }),
    });

    assert.equal(response.status, 200);
    assert.equal(payload.originalEventId, sampleEvent.id);
    assert.equal(payload.location, sampleEvent.location.name);
    assert.equal(payload.title, "Kollision på E4 i Stockholm");
    assert.match(payload.imageUrl, /picsum\.photos\/seed\/123/);
    assert.match(receivedPrompt, /Trafikolycka, Stockholm/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("generate article endpoint fails closed when Gemini is not configured", async () => {
  const server = createServer({ ai: null, apiKey: "" });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const { response, payload } = await jsonFetch(`http://127.0.0.1:${address.port}/api/generate-article`, {
      method: "POST",
      body: JSON.stringify({ event: sampleEvent }),
    });

    assert.equal(response.status, 500);
    assert.equal(payload.error, "Article generation is not configured");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
