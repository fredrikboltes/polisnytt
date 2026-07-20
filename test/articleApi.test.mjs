import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createArticleApi } from '../server/articleApi.mjs';

const event = {
  id: 123,
  datetime: '2026-07-20 10:00:00 +02:00',
  name: 'Trafikolycka',
  summary: 'En officiell sammanfattning',
  url: '/aktuellt/handelser/2026/juli/20/123',
  type: 'Trafikolycka',
  location: { name: 'Stockholm', gps: '59.3,18.0' },
};

const article = {
  id: 'article-123',
  originalEventId: 123,
  title: 'Rubrik',
  lead: 'Ingress',
  body: 'Brödtext',
  category: 'Blåljus',
  location: 'Stockholm',
  timestamp: event.datetime,
  imageUrl: 'https://picsum.photos/seed/123/800/450',
};

const startApi = async (options) => {
  const api = createArticleApi(options);
  const server = createServer((request, response) => {
    api(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
};

const post = (url, payload, headers) => fetch(`${url}/api/generate-article`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(payload),
});

test('rejects events that are not in the official Police feed', async (context) => {
  let providerCalls = 0;
  const server = await startApi({
    fetchImpl: async () => Response.json([event]),
    generateArticle: async () => {
      providerCalls += 1;
      return article;
    },
  });
  context.after(server.close);

  const response = await post(server.url, { eventId: 999, county: 'Stockholm' });

  assert.equal(response.status, 404);
  assert.equal(providerCalls, 0);
});

test('uses official event data and deduplicates concurrent generation', async (context) => {
  let policeCalls = 0;
  let providerCalls = 0;
  let releaseProvider;
  const providerResult = new Promise(resolve => {
    releaseProvider = resolve;
  });
  const server = await startApi({
    apiKey: 'server-only-key',
    fetchImpl: async () => {
      policeCalls += 1;
      return Response.json([event]);
    },
    generateArticle: async (officialEvent, key) => {
      providerCalls += 1;
      assert.deepEqual(officialEvent, event);
      assert.equal(key, 'server-only-key');
      return providerResult;
    },
  });
  context.after(server.close);

  const first = post(server.url, { eventId: event.id, county: 'Stockholm' });
  const second = post(server.url, { eventId: event.id, county: 'Stockholm' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(policeCalls, 1);
  assert.equal(providerCalls, 1);

  releaseProvider(article);
  const responses = await Promise.all([first, second]);
  assert.deepEqual(await responses[0].json(), article);
  assert.deepEqual(await responses[1].json(), article);

  const cached = await post(server.url, { eventId: event.id, county: 'Stockholm' });
  assert.equal(cached.status, 200);
  assert.equal(providerCalls, 1);
});

test('sanitizes provider failures', async (context) => {
  const server = await startApi({
    fetchImpl: async () => Response.json([event]),
    generateArticle: async () => {
      throw new Error('secret provider details');
    },
  });
  context.after(server.close);

  const response = await post(server.url, { eventId: event.id, county: 'Stockholm' });

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Unable to generate article' });
});

test('rejects invalid counties before making external requests', async (context) => {
  let policeCalls = 0;
  const server = await startApi({
    fetchImpl: async () => {
      policeCalls += 1;
      return Response.json([event]);
    },
  });
  context.after(server.close);

  const response = await post(server.url, { eventId: event.id, county: 'Not a county' });

  assert.equal(response.status, 400);
  assert.equal(policeCalls, 0);
});
