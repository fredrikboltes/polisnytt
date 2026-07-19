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
  const middleware = createArticleApiMiddleware({
    fetchPoliceEvents: async () => [policeEvent],
    ...options,
  });
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
    body: JSON.stringify({ eventId: policeEvent.id }),
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
    body: JSON.stringify({ eventId: '123' }),
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
    body: JSON.stringify({ eventId: policeEvent.id }),
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
    body: JSON.stringify({ eventId: policeEvent.id }),
  });

  assert.equal(response.status, 503);
});

test('does not intercept unrelated routes', async () => {
  const baseUrl = await startServer();
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 404);
});

test('rejects event IDs that are not in the official police feed', async () => {
  let providerCalled = false;
  const baseUrl = await startServer({
    fetchPoliceEvents: async () => [],
    generateContent: async () => {
      providerCalled = true;
    },
  });

  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: 999999 }),
  });

  assert.equal(response.status, 404);
  assert.equal(providerCalled, false);
});

test('caches generated articles to prevent repeated provider charges', async () => {
  let providerCalls = 0;
  const baseUrl = await startServer({
    generateContent: async () => {
      providerCalls++;
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
  const request = () => fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: policeEvent.id }),
  });

  const first = await request();
  const second = await request();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(providerCalls, 1);
  assert.deepEqual(await second.json(), await first.json());
});

test('rate-limits uncached generation requests from one client', async () => {
  const events = Array.from({ length: 11 }, (_, index) => ({
    ...policeEvent,
    id: index + 1,
  }));
  const baseUrl = await startServer({
    fetchPoliceEvents: async () => events,
    generateContent: async () => ({
      text: JSON.stringify({
        title: 'Polisnotis',
        lead: 'En händelse har inträffat.',
        body: 'Polisen arbetar med händelsen.',
        category: 'Blåljus',
      }),
    }),
  });

  for (const event of events.slice(0, 10)) {
    const response = await fetch(`${baseUrl}/api/generate-article`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: event.id }),
    });
    assert.equal(response.status, 200);
  }

  const limitedResponse = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: events[10].id }),
  });
  assert.equal(limitedResponse.status, 429);
});
