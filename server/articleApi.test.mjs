import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';
import { createArticleApiMiddleware } from './articleApi.mjs';

const openServers = new Set();

afterEach(async () => {
  await Promise.all([...openServers].map(server => new Promise(resolve => server.close(resolve))));
  openServers.clear();
});

const startServer = async (options) => {
  const middleware = createArticleApiMiddleware(options);
  const server = createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  openServers.add(server);
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
};

const policeEvent = {
  id: 123,
  datetime: '2026-07-19 10:00:00 +02:00',
  name: 'Trafikolycka',
  summary: 'Två fordon har kolliderat.',
  url: '/aktuellt/handelser/2026/juli/19/olycka/',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

test('generates an article without returning server configuration', async () => {
  let providerRequest;
  const baseUrl = await startServer({
    apiKey: 'server-only-key',
    generateContent: async (request) => {
      providerRequest = request;
      return {
        text: JSON.stringify({
          title: 'Olycka i Stockholm',
          lead: 'Två fordon kolliderade på söndagen.',
          body: 'Polisen arbetar på platsen.',
          category: 'Trafikolycka',
        }),
      };
    },
  });

  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: policeEvent }),
  });
  const article = await response.json();

  assert.equal(response.status, 200);
  assert.equal(article.originalEventId, policeEvent.id);
  assert.equal(article.location, policeEvent.location.name);
  assert.equal(article.title, 'Olycka i Stockholm');
  assert.match(providerRequest.contents, /Två fordon har kolliderat/);
  assert.doesNotMatch(JSON.stringify(article), /server-only-key/);
});

test('rejects invalid requests before calling the provider', async () => {
  let providerCalled = false;
  const baseUrl = await startServer({
    generateContent: async () => {
      providerCalled = true;
    },
  });

  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: { id: 123 } }),
  });

  assert.equal(response.status, 400);
  assert.equal(providerCalled, false);
});

test('returns a sanitized error when the provider fails', async (context) => {
  context.mock.method(console, 'error', () => {});
  const baseUrl = await startServer({
    apiKey: 'secret-that-must-not-leak',
    generateContent: async () => {
      throw new Error('Provider rejected secret-that-must-not-leak');
    },
  });

  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: policeEvent }),
  });
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.doesNotMatch(body, /secret-that-must-not-leak/);
});

test('fails safely when the API key is not configured', async () => {
  const baseUrl = await startServer();
  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: policeEvent }),
  });

  assert.equal(response.status, 503);
});

test('does not intercept unrelated routes', async () => {
  const baseUrl = await startServer();
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 404);
});
