import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';
import { createArticleApi } from '../server/articleApi.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

const startServer = async (middleware) => {
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

const event = {
  id: 123,
  datetime: '2026-07-18 10:00:00 +02:00',
  name: 'Trafikolycka',
  summary: 'En olycka har inträffat.',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholms län',
    gps: '59.0,18.0',
  },
};

test('the HTML entrypoint boots the Vite application', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /<script type="module" src="\/index\.tsx"><\/script>/);
  assert.doesNotMatch(html, /@google\/genai/);
});

test('generates an article while keeping the API key on the server', async () => {
  let receivedApiKey;
  const article = {
    id: 'article-123',
    originalEventId: 123,
    title: 'Rubrik',
    lead: 'Ingress',
    body: 'Text',
    category: 'Trafik',
    location: 'Stockholms län',
    timestamp: event.datetime,
    imageUrl: 'https://example.test/image.jpg',
  };
  const middleware = createArticleApi({
    apiKey: 'server-secret',
    generateArticle: async (receivedEvent, apiKey) => {
      assert.deepEqual(receivedEvent, event);
      receivedApiKey = apiKey;
      return article;
    },
  });
  const baseUrl = await startServer(middleware);

  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  });

  assert.equal(response.status, 200);
  assert.equal(receivedApiKey, 'server-secret');
  assert.deepEqual(await response.json(), { article });
});

test('rejects malformed events before calling Gemini', async () => {
  let generatorCalled = false;
  const middleware = createArticleApi({
    apiKey: 'server-secret',
    generateArticle: async () => {
      generatorCalled = true;
    },
  });
  const baseUrl = await startServer(middleware);

  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: { id: 123 } }),
  });

  assert.equal(response.status, 400);
  assert.equal(generatorCalled, false);
  assert.deepEqual(await response.json(), { error: 'Invalid police event' });
});

test('does not expose provider error details to clients or logs', async () => {
  const loggedMessages = [];
  const middleware = createArticleApi({
    apiKey: 'server-secret',
    generateArticle: async () => {
      throw new Error('provider response included sensitive details');
    },
    logger: {
      error: message => loggedMessages.push(message),
    },
  });
  const baseUrl = await startServer(middleware);

  const response = await fetch(`${baseUrl}/api/generate-article`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Could not generate article' });
  assert.deepEqual(loggedMessages, ['Article generation failed']);
});

test('passes unrelated paths to Vite', async () => {
  const baseUrl = await startServer(createArticleApi({ apiKey: 'server-secret' }));

  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 404);
});
