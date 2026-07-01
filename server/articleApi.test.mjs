import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createArticleApiMiddleware } from './articleApi.mjs';

const policeEvent = {
  id: 123,
  datetime: '2026-07-01 10:00:00 +02:00',
  name: '01 juli 10.00, Trafikolycka, Stockholm',
  summary: 'En olycka har inträffat på E4.',
  url: 'https://polisen.se/aktuellt/handelser/',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

class MockRequest extends EventEmitter {
  constructor({ url = '/api/generate-article', method = 'POST', body = policeEvent } = {}) {
    super();
    this.url = url;
    this.method = method;
    this.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  setEncoding() {}

  start() {
    this.emit('data', this.body);
    this.emit('end');
  }
}

class MockResponse {
  constructor() {
    this.headers = new Map();
    this.statusCode = 200;
    this.body = '';
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });
  }

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
  }

  end(body) {
    this.body = body;
    this.resolveFinished();
  }

  json() {
    return JSON.parse(this.body);
  }
}

const runMiddleware = async (middleware, req) => {
  const res = new MockResponse();
  const handled = middleware(req, res, () => {
    res.nextCalled = true;
    res.resolveFinished();
  });

  req.start?.();
  await Promise.all([handled, res.finished]);
  return res;
};

test('generates an article without exposing the Gemini key to the client', async () => {
  const generatedRequests = [];
  const middleware = createArticleApiMiddleware({
    apiKey: 'server-only-key',
    now: () => 456,
    aiFactory: (apiKey) => {
      assert.equal(apiKey, 'server-only-key');
      return {
        models: {
          generateContent: async (request) => {
            generatedRequests.push(request);
            return {
              text: JSON.stringify({
                title: 'Rubrik',
                lead: 'Ingress',
                body: 'Brödtext',
                category: 'Blåljus',
              }),
            };
          },
        },
      };
    },
  });

  const res = await runMiddleware(middleware, new MockRequest());

  assert.equal(res.statusCode, 200);
  assert.equal(generatedRequests.length, 1);
  assert.deepEqual(res.json().article, {
    id: 'article-123-456',
    originalEventId: 123,
    title: 'Rubrik',
    lead: 'Ingress',
    body: 'Brödtext',
    category: 'Blåljus',
    location: 'Stockholm',
    timestamp: '2026-07-01 10:00:00 +02:00',
    imageUrl: 'https://picsum.photos/seed/123/800/450',
  });
});

test('returns a server error when GEMINI_API_KEY is missing', async () => {
  const middleware = createArticleApiMiddleware({
    apiKey: '',
    aiFactory: () => {
      throw new Error('AI client should not be created without a key');
    },
  });

  const res = await runMiddleware(middleware, new MockRequest());

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: 'GEMINI_API_KEY is not configured' });
});

test('passes unrelated requests to the next middleware', async () => {
  const middleware = createArticleApiMiddleware({ apiKey: 'server-only-key' });
  const res = await runMiddleware(middleware, new MockRequest({ url: '/assets/app.js', body: '' }));

  assert.equal(res.nextCalled, true);
});
