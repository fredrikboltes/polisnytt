import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createGenerateArticleHandler } from './articleApi.mjs';

const policeEvent = {
  id: 123,
  datetime: '2026-06-30 10:15:00 +02:00',
  name: 'Trafikolycka, Stockholm',
  summary: 'Två bilar har kolliderat.',
  url: 'https://polisen.se/aktuellt/handelser/123',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

class MockRequest extends EventEmitter {
  constructor({ method = 'POST', body = '' } = {}) {
    super();
    this.method = method;
    this.body = body;
    this.destroyed = false;
  }

  setEncoding() {}

  destroy() {
    this.destroyed = true;
  }

  flush() {
    queueMicrotask(() => {
      if (this.body) {
        this.emit('data', this.body);
      }
      this.emit('end');
    });
  }
}

class MockResponse {
  constructor(resolve) {
    this.statusCode = 200;
    this.headers = {};
    this.resolve = resolve;
  }

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }

  end(body) {
    this.body = body;
    this.resolve(this);
  }
}

async function invoke(handler, { method = 'POST', body = {} } = {}) {
  let response;
  const done = new Promise((resolve) => {
    response = new MockResponse(resolve);
  });
  const request = new MockRequest({
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  void handler(request, response);
  request.flush();

  const result = await done;
  return {
    statusCode: result.statusCode,
    headers: result.headers,
    body: JSON.parse(result.body),
  };
}

test('returns a generated article without exposing Gemini to the client', async () => {
  let constructedKey;
  let generateRequest;

  class FakeGoogleGenAI {
    constructor({ apiKey }) {
      constructedKey = apiKey;
      this.models = {
        generateContent: async (request) => {
          generateRequest = request;
          return {
            text: JSON.stringify({
              title: 'Kollision i Stockholm',
              lead: 'Två bilar har kolliderat i Stockholm.',
              body: 'Polisen uppger att olyckan inträffade under förmiddagen.',
              category: 'Trafikolycka',
            }),
          };
        },
      };
    }
  }

  const handler = createGenerateArticleHandler({
    apiKey: 'server-only-key',
    GoogleGenAIImpl: FakeGoogleGenAI,
    now: () => 42,
  });

  const response = await invoke(handler, { body: { event: policeEvent } });

  assert.equal(response.statusCode, 200);
  assert.equal(constructedKey, 'server-only-key');
  assert.equal(generateRequest.model, 'gemini-3-flash-preview');
  assert.equal(generateRequest.config.responseMimeType, 'application/json');
  assert.match(generateRequest.contents, /Trafikolycka, Stockholm/);
  assert.deepEqual(response.body.article, {
    id: 'article-123-42',
    originalEventId: 123,
    title: 'Kollision i Stockholm',
    lead: 'Två bilar har kolliderat i Stockholm.',
    body: 'Polisen uppger att olyckan inträffade under förmiddagen.',
    category: 'Trafikolycka',
    location: 'Stockholm',
    timestamp: '2026-06-30 10:15:00 +02:00',
    imageUrl: 'https://picsum.photos/seed/123/800/450',
  });
});

test('rejects requests when the Gemini key is missing', async () => {
  const handler = createGenerateArticleHandler({
    apiKey: '',
    GoogleGenAIImpl: class {
      constructor() {
        throw new Error('Gemini should not be constructed without a key');
      }
    },
  });

  const response = await invoke(handler, { body: { event: policeEvent } });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, 'Gemini API key is not configured');
});

test('rejects invalid police events before calling Gemini', async () => {
  const handler = createGenerateArticleHandler({
    apiKey: 'server-only-key',
    GoogleGenAIImpl: class {
      constructor() {
        throw new Error('Gemini should not be called for invalid input');
      }
    },
  });

  const response = await invoke(handler, { body: { event: { id: 123 } } });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'Request body must include a valid police event');
});

test('allows only POST requests', async () => {
  const handler = createGenerateArticleHandler({ apiKey: 'server-only-key' });

  const response = await invoke(handler, { method: 'GET', body: '' });

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, 'POST');
  assert.equal(response.body.error, 'Method not allowed');
});
