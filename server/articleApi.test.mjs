import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';
import { createArticleApiHandler } from './articleApi.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
});

const startServer = async handler => {
  const server = createServer((request, response) => {
    handler(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
};

const event = {
  id: 123,
  datetime: '2026-07-16 10:00:00 +02:00',
  name: 'Trafikolycka',
  summary: 'Två bilar har kolliderat.',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholms län',
  },
};

test('generates an article without exposing the API key to the client', async () => {
  let receivedKey;
  const handler = createArticleApiHandler({
    apiKey: 'server-only-secret',
    createClient: key => {
      receivedKey = key;
      return {
        models: {
          generateContent: async () => ({
            text: JSON.stringify({
              title: 'Kollision i Stockholm',
              lead: 'Två bilar kolliderade under torsdagen.',
              body: 'Polisen larmades till platsen.',
              category: 'Trafikolycka',
            }),
          }),
        },
      };
    },
  });
  const baseUrl = await startServer(handler);

  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  });
  const article = await response.json();

  assert.equal(response.status, 200);
  assert.equal(receivedKey, 'server-only-secret');
  assert.equal(article.originalEventId, event.id);
  assert.equal(article.title, 'Kollision i Stockholm');
  assert.equal(article.location, event.location.name);
  assert.match(article.id, /^article-123-\d+$/);
  assert.doesNotMatch(JSON.stringify(article), /server-only-secret/);
});

test('fails clearly when article generation is not configured', async () => {
  const baseUrl = await startServer(createArticleApiHandler());
  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Article generation is not configured.',
  });
});

test('rejects malformed police events before calling Gemini', async () => {
  let clientCreated = false;
  const handler = createArticleApiHandler({
    apiKey: 'server-only-secret',
    createClient: () => {
      clientCreated = true;
      return {};
    },
  });
  const baseUrl = await startServer(handler);
  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: { id: 123 } }),
  });

  assert.equal(response.status, 400);
  assert.equal(clientCreated, false);
});
