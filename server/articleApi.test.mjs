import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createArticleApiHandler } from './articleApi.mjs';

const sampleEvent = {
  id: 123,
  datetime: '2026-06-25 10:15:00 +02:00',
  name: '25 juni 10.15, Trafikolycka, Stockholm',
  summary: 'Två personbilar har kolliderat på Essingeleden.',
  url: 'https://polisen.se/aktuellt/handelser/example',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

const createRequest = (body, { method = 'POST', url = '/api/generate-article' } = {}) => {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  return Object.assign(Readable.from(chunks), { method, url });
};

const createResponse = () => ({
  statusCode: 200,
  headers: {},
  body: '',
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  },
  end(chunk = '') {
    this.body += chunk;
  },
});

test('generate article endpoint returns a server-generated article', async () => {
  let constructedApiKey;
  let generateRequest;

  class FakeGoogleGenAI {
    constructor({ apiKey }) {
      constructedApiKey = apiKey;
      this.models = {
        generateContent: async (request) => {
          generateRequest = request;
          return {
            text: JSON.stringify({
              title: 'Stor trafikpåverkan efter kollision',
              lead: 'Två bilar kolliderade på Essingeleden under förmiddagen.',
              body: 'Polisen uppger att trafiken påverkades kraftigt efter olyckan.',
              category: 'Trafikolycka',
            }),
          };
        },
      };
    }
  }

  const handler = createArticleApiHandler({
    apiKey: 'server-only-secret',
    GoogleGenAIClass: FakeGoogleGenAI,
  });
  const res = createResponse();

  await handler(createRequest({ event: sampleEvent }), res, () => {
    assert.fail('API request should not fall through to the next middleware');
  });

  const article = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(constructedApiKey, 'server-only-secret');
  assert.match(generateRequest.contents, /Trafikolycka, Stockholm/);
  assert.deepEqual(
    {
      originalEventId: article.originalEventId,
      title: article.title,
      lead: article.lead,
      body: article.body,
      category: article.category,
      location: article.location,
      timestamp: article.timestamp,
      imageUrl: article.imageUrl,
    },
    {
      originalEventId: sampleEvent.id,
      title: 'Stor trafikpåverkan efter kollision',
      lead: 'Två bilar kolliderade på Essingeleden under förmiddagen.',
      body: 'Polisen uppger att trafiken påverkades kraftigt efter olyckan.',
      category: 'Trafikolycka',
      location: sampleEvent.location.name,
      timestamp: sampleEvent.datetime,
      imageUrl: `https://picsum.photos/seed/${sampleEvent.id}/800/450`,
    },
  );
  assert.match(article.id, /^article-123-\d+$/);
});

test('generate article endpoint rejects invalid event payloads', async () => {
  let generated = false;

  class FakeGoogleGenAI {
    constructor() {
      this.models = {
        generateContent: async () => {
          generated = true;
        },
      };
    }
  }

  const handler = createArticleApiHandler({
    apiKey: 'server-only-secret',
    GoogleGenAIClass: FakeGoogleGenAI,
  });
  const res = createResponse();

  await handler(createRequest({ event: { id: 123 } }), res, () => {
    assert.fail('Invalid API request should not fall through to the next middleware');
  });

  assert.equal(res.statusCode, 400);
  assert.equal(generated, false);
  assert.deepEqual(JSON.parse(res.body), { error: 'Invalid police event payload' });
});

test('generate article endpoint fails closed when Gemini key is missing', async () => {
  const handler = createArticleApiHandler({ apiKey: '' });
  const res = createResponse();

  await handler(createRequest({ event: sampleEvent }), res, () => {
    assert.fail('API request should not fall through to the next middleware');
  });

  assert.equal(res.statusCode, 500);
  assert.deepEqual(JSON.parse(res.body), { error: 'GEMINI_API_KEY is not configured' });
});

test('article API middleware ignores non-article routes', async () => {
  const handler = createArticleApiHandler({ apiKey: 'server-only-secret' });
  const res = createResponse();
  let nextCalled = false;

  await handler(createRequest(undefined, { method: 'GET', url: '/index.html' }), res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.body, '');
});

