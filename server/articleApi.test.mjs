import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createArticleApiMiddleware } from './articleApi.mjs';

const policeEvent = {
  id: 123,
  datetime: '2026-06-29 12:00',
  name: '29 juni 12.00, Trafikolycka, Stockholm',
  summary: 'En trafikolycka har inträffat.',
  url: 'https://polisen.se/aktuellt/handelser/',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

test('ignores requests for other paths', async () => {
  const middleware = createArticleApiMiddleware({
    generateContent: async () => {
      throw new Error('should not be called');
    },
  });

  let nextCalled = false;
  await middleware(createRequest('/other'), createResponse(), () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test('generates an article through the server-side Gemini caller', async () => {
  let capturedRequest;
  const middleware = createArticleApiMiddleware({
    generateContent: async request => {
      capturedRequest = request;
      return {
        text: JSON.stringify({
          title: 'Trafikolycka i Stockholm',
          lead: 'En olycka inträffade i Stockholm under måndagen.',
          body: 'Polisen rapporterar att en trafikolycka har inträffat.',
          category: 'Trafikolycka',
        }),
      };
    },
  });

  const response = createResponse();
  await middleware(
    createRequest('/api/generate-article', JSON.stringify({ event: policeEvent })),
    response,
    () => assert.fail('next should not be called for API path')
  );

  assert.equal(response.statusCode, 200);
  assert.equal(capturedRequest.model, 'gemini-3-flash-preview');
  assert.equal(capturedRequest.config.responseMimeType, 'application/json');

  const article = JSON.parse(response.body);
  assert.equal(article.originalEventId, policeEvent.id);
  assert.equal(article.title, 'Trafikolycka i Stockholm');
  assert.equal(article.location, policeEvent.location.name);
  assert.equal(article.imageUrl, `https://picsum.photos/seed/${policeEvent.id}/800/450`);
});

test('returns a server error without exposing model failure details', async () => {
  const middleware = createArticleApiMiddleware({
    generateContent: async () => ({
      text: JSON.stringify({
        title: '',
        lead: 'Ingress',
        body: 'Brödtext',
        category: 'Blåljus',
      }),
    }),
  });

  const response = createResponse();
  await middleware(
    createRequest('/api/generate-article', JSON.stringify({ event: policeEvent })),
    response,
    () => assert.fail('next should not be called for API path')
  );

  assert.equal(response.statusCode, 502);
  assert.deepEqual(JSON.parse(response.body), {
    error: 'Kunde inte generera artikel.',
  });
});

function createRequest(url, body = '') {
  return {
    method: 'POST',
    url,
    async *[Symbol.asyncIterator]() {
      if (body) {
        yield Buffer.from(body);
      }
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}
