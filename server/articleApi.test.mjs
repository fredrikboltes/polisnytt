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

test('deduplicates concurrent requests and caches the generated article', async () => {
  let providerCalls = 0;
  const baseUrl = await startServer({
    generateContent: async () => {
      providerCalls++;
      await new Promise(resolve => setTimeout(resolve, 10));
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

  const concurrentResponses = await Promise.all(
    Array.from({ length: 11 }, () => request())
  );
  const cachedResponse = await request();
  const articles = await Promise.all(
    [...concurrentResponses, cachedResponse].map(response => response.json())
  );

  assert.equal(concurrentResponses.every(response => response.status === 200), true);
  assert.equal(cachedResponse.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(articles.every(article => article.id === articles[0].id), true);
});

test('rate-limits uncached generation requests from one client', async () => {
  const events = Array.from({ length: 4 }, (_, index) => ({
    ...policeEvent,
    id: index + 1,
  }));
  const baseUrl = await startServer({
    fetchPoliceEvents: async () => events,
    rateLimit: 2,
    generateContent: async () => ({
      text: JSON.stringify({
        title: 'Polisnotis',
        lead: 'En händelse har inträffat.',
        body: 'Polisen arbetar med händelsen.',
        category: 'Blåljus',
      }),
    }),
  });

  for (const event of events.slice(0, 2)) {
    const response = await fetch(`${baseUrl}/api/generate-article`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.10',
      },
      body: JSON.stringify({ eventId: event.id }),
    });
    assert.equal(response.status, 200);
  }

  const limitedResponse = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.10',
    },
    body: JSON.stringify({ eventId: events[2].id }),
  });
  assert.equal(limitedResponse.status, 429);

  const otherClientResponse = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.20',
    },
    body: JSON.stringify({ eventId: events[3].id }),
  });
  assert.equal(otherClientResponse.status, 200);
});

const countyOnlyEvent = {
  ...policeEvent,
  id: 650664,
  location: {
    name: 'Visby',
    gps: '57.6348,18.2948',
  },
};

const articlePayload = {
  text: JSON.stringify({
    title: 'Händelse på Gotland',
    lead: 'Polisen rapporterar en händelse i Visby.',
    body: 'Arbetet pågår på platsen.',
    category: 'Blåljus',
  }),
};

test('resolves event IDs from a county feed that is missing from the national cap', async () => {
  const requestedLocations = [];
  const baseUrl = await startServer({
    fetchPoliceEvents: async (locationName) => {
      requestedLocations.push(locationName);
      if (locationName === 'Gotlands län') return [countyOnlyEvent];
      return [];
    },
    generateContent: async () => articlePayload,
  });

  const missingNational = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: countyOnlyEvent.id }),
  });
  const foundInCounty = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: countyOnlyEvent.id, location: 'Gotland' }),
  });
  const article = await foundInCounty.json();

  assert.equal(missingNational.status, 404);
  assert.equal(foundInCounty.status, 200);
  assert.equal(article.originalEventId, countyOnlyEvent.id);
  assert.deepEqual(requestedLocations, [undefined, 'Gotlands län']);
});

test('rejects invalid location values before calling the provider', async () => {
  let providerCalled = false;
  let policeFeedCalled = false;
  const baseUrl = await startServer({
    fetchPoliceEvents: async () => {
      policeFeedCalled = true;
      return [policeEvent];
    },
    generateContent: async () => {
      providerCalled = true;
    },
  });

  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: policeEvent.id, location: 123 }),
  });

  assert.equal(response.status, 400);
  assert.equal(providerCalled, false);
  assert.equal(policeFeedCalled, false);
});
