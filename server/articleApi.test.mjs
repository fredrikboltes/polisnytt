import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createArticleApiMiddleware } from './articleApi.mjs';

const policeEvent = {
  id: 123,
  datetime: '2026-01-05 12:00:00 +01:00',
  name: 'Trafikolycka, Stockholm',
  summary: 'En trafikolycka har inträffat.',
  url: 'https://polisen.se/aktuellt/handelser/123',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

const request = async (middleware, { method = 'POST', body } = {}) => {
  const server = http.createServer((req, res) => {
    middleware(req, res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/generate-article`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

test('article API returns generated article for a valid police event', async () => {
  const expectedArticle = {
    id: 'article-123',
    originalEventId: 123,
    title: 'Rubrik',
    lead: 'Ingress',
    body: 'Broedtext',
    category: 'Blaljus',
    location: 'Stockholm',
    timestamp: policeEvent.datetime,
    imageUrl: 'https://example.com/image.jpg',
  };

  const response = await request(createArticleApiMiddleware({
    generateArticle: async (event) => {
      assert.deepEqual(event, policeEvent);
      return expectedArticle;
    },
  }), {
    body: { event: policeEvent },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { article: expectedArticle });
});

test('article API rejects invalid event payloads before generation', async () => {
  let generated = false;

  const response = await request(createArticleApiMiddleware({
    generateArticle: async () => {
      generated = true;
      return {};
    },
  }), {
    body: { event: { ...policeEvent, location: undefined } },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'Invalid police event payload');
  assert.equal(generated, false);
});

test('article API rejects unsupported methods', async () => {
  const response = await request(createArticleApiMiddleware({
    generateArticle: async () => ({}),
  }), {
    method: 'GET',
  });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});
