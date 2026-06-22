import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createArticleApiMiddleware } from './articleApi.mjs';

const sampleEvent = {
  id: 123,
  datetime: '2026-06-22 10:00:00 +02:00',
  name: 'Trafikolycka, Stockholm',
  summary: 'En olycka har inträffat på E4.',
  url: 'https://polisen.se/aktuellt/handelser/123/',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

const withServer = async (middleware, run) => {
  const server = http.createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end('not found');
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

test('generate article route returns an article without client-side Gemini access', async () => {
  let receivedApiKey;
  let receivedPrompt;
  const middleware = createArticleApiMiddleware({
    apiKey: 'server-only-key',
    createClient: (apiKey) => {
      receivedApiKey = apiKey;
      return {
        models: {
          generateContent: async ({ contents }) => {
            receivedPrompt = contents;
            return {
              text: JSON.stringify({
                title: 'Rubrik',
                lead: 'Ingress',
                body: 'Brodtext',
                category: 'Blaljus',
              }),
            };
          },
        },
      };
    },
  });

  await withServer(middleware, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate-article`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: sampleEvent }),
    });

    assert.equal(response.status, 200);
    const { article } = await response.json();
    assert.equal(receivedApiKey, 'server-only-key');
    assert.match(receivedPrompt, /Trafikolycka, Stockholm/);
    assert.equal(article.originalEventId, sampleEvent.id);
    assert.equal(article.title, 'Rubrik');
    assert.equal(article.location, 'Stockholm');
    assert.equal(article.imageUrl, `https://picsum.photos/seed/${sampleEvent.id}/800/450`);
  });
});

test('generate article route rejects malformed events', async () => {
  let createClientCalled = false;
  const middleware = createArticleApiMiddleware({
    apiKey: 'server-only-key',
    createClient: () => {
      createClientCalled = true;
    },
  });

  await withServer(middleware, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate-article`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: { id: 123 } }),
    });

    assert.equal(response.status, 400);
    assert.equal(createClientCalled, false);
  });
});
