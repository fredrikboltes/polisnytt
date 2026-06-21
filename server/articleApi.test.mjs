import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createArticleApiMiddleware } from './articleApi.mjs';

const sampleEvent = {
  id: 123,
  datetime: '2026-06-21 10:00:00 +02:00',
  name: '21 juni 10.00, Trafikolycka, Stockholm',
  summary: 'En mindre trafikolycka har inträffat.',
  url: 'https://polisen.se/aktuellt/handelser/',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

class MockRequest extends Readable {
  constructor({ method = 'POST', url = '/api/generate-article', body = '' } = {}) {
    super();
    this.method = method;
    this.url = url;
    this.body = body;
  }

  _read() {
    this.push(this.body);
    this.push(null);
  }
}

class MockResponse {
  constructor() {
    this.statusCode = 200;
    this.headers = new Map();
    this.body = '';
  }

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
  }

  end(chunk = '') {
    this.body += chunk;
    this.ended = true;
  }

  json() {
    return JSON.parse(this.body);
  }
}

const invoke = async (middleware, requestOptions) => {
  const req = new MockRequest(requestOptions);
  const res = new MockResponse();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
};

test('passes through non-article API requests', async () => {
  const middleware = createArticleApiMiddleware({ apiKey: 'secret' });
  const { res, nextCalled } = await invoke(middleware, { url: '/assets/app.js' });

  assert.equal(nextCalled, true);
  assert.equal(res.ended, undefined);
});

test('returns an error when the Gemini API key is missing', async () => {
  let constructed = false;
  const middleware = createArticleApiMiddleware({
    apiKey: '',
    createAI: () => {
      constructed = true;
    },
  });

  const { res, nextCalled } = await invoke(middleware, {
    body: JSON.stringify({ event: sampleEvent }),
  });

  assert.equal(nextCalled, false);
  assert.equal(constructed, false);
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error, 'Gemini API key is not configured');
});

test('rejects invalid police event payloads', async () => {
  const middleware = createArticleApiMiddleware({
    apiKey: 'secret',
    createAI: () => ({
      models: {
        generateContent: async () => {
          throw new Error('Gemini should not be called for invalid input');
        },
      },
    }),
  });

  const { res } = await invoke(middleware, {
    body: JSON.stringify({ event: { id: 123 } }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'Invalid police event payload');
});

test('generates an article for valid requests without exposing the API key', async () => {
  let receivedKey;
  let receivedPrompt;
  const middleware = createArticleApiMiddleware({
    apiKey: 'server-only-secret',
    createAI: (apiKey) => {
      receivedKey = apiKey;
      return {
        models: {
          generateContent: async ({ contents }) => {
            receivedPrompt = contents;
            return {
              text: JSON.stringify({
                title: 'Trafikolycka i Stockholm',
                lead: 'En mindre trafikolycka inträffade under söndagen.',
                body: 'Polisen uppger att händelsen hanteras på plats.',
                category: 'Trafikolycka',
              }),
            };
          },
        },
      };
    },
  });

  const { res } = await invoke(middleware, {
    body: JSON.stringify({ event: sampleEvent }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(receivedKey, 'server-only-secret');
  assert.match(receivedPrompt, /Trafikolycka, Stockholm/);

  const { article } = res.json();
  assert.equal(article.originalEventId, sampleEvent.id);
  assert.equal(article.title, 'Trafikolycka i Stockholm');
  assert.equal(article.location, 'Stockholm');
  assert.equal(article.imageUrl, 'https://picsum.photos/seed/123/800/450');
});
