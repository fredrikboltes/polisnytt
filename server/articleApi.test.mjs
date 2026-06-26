import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createArticleApiHandler, createNewsArticle } from './articleApi.mjs';

const event = {
  id: 123,
  datetime: '2026-06-26 09:10:00',
  name: '26 juni 09.10, Trafikolycka, Stockholm',
  summary: 'En trafikolycka har inträffat.',
  url: 'https://polisen.se/aktuellt/handelser/',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

const callHandler = async (handler, { method = 'POST', body } = {}) => {
  const req = Readable.from(body ? [body] : []);
  req.method = method;

  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk = '') {
      this.body += chunk;
    },
  };

  await handler(req, res);
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    json: res.body ? JSON.parse(res.body) : null,
  };
};

test('createNewsArticle maps a generated Gemini payload to the public article shape', () => {
  const article = createNewsArticle(event, {
    title: 'Trafikolycka i Stockholm',
    lead: 'Polisen rapporterar om en trafikolycka.',
    body: 'Räddningstjänst och polis är på plats.',
    category: 'Trafikolycka',
  }, 42);

  assert.deepEqual(article, {
    id: 'article-123-42',
    originalEventId: 123,
    title: 'Trafikolycka i Stockholm',
    lead: 'Polisen rapporterar om en trafikolycka.',
    body: 'Räddningstjänst och polis är på plats.',
    category: 'Trafikolycka',
    location: 'Stockholm',
    timestamp: '2026-06-26 09:10:00',
    imageUrl: 'https://picsum.photos/seed/123/800/450',
  });
});

test('article API returns generated article JSON for valid police events', async () => {
  const article = createNewsArticle(event, {
    title: 'Rubrik',
    lead: 'Ingress',
    body: 'Brödtext',
    category: 'Blåljus',
  }, 99);
  const handler = createArticleApiHandler({
    generateArticle: async (receivedEvent) => {
      assert.deepEqual(receivedEvent, event);
      return article;
    },
  });

  const response = await callHandler(handler, {
    body: JSON.stringify({ event }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json');
  assert.deepEqual(response.json, { article });
});

test('article API rejects invalid request bodies before generating', async () => {
  let called = false;
  const handler = createArticleApiHandler({
    generateArticle: async () => {
      called = true;
    },
  });

  const response = await callHandler(handler, {
    body: JSON.stringify({ event: { id: 123 } }),
  });

  assert.equal(response.statusCode, 400);
  assert.equal(called, false);
});

test('article API does not expose backend errors to clients', async () => {
  const handler = createArticleApiHandler({
    generateArticle: async () => {
      throw new Error('secret backend detail');
    },
  });

  const response = await callHandler(handler, {
    body: JSON.stringify({ event }),
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json, { error: 'Could not generate article' });
});
