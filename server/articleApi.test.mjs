import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  createArticleApiHandler,
  generateArticleFromEvent,
  parseGeneratedArticle,
} from './articleApi.mjs';

const policeEvent = {
  id: 123,
  datetime: '2026-06-24 12:34',
  name: '24 juni 12.34, Trafikolycka, Stockholm',
  summary: 'Två personbilar har kolliderat på E4.',
  url: 'https://polisen.se/aktuellt/handelser/',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

const generatedPayload = {
  title: 'Kollision på E4 i Stockholm',
  lead: 'Två bilar kolliderade på E4 under onsdagen.',
  body: 'Polisen har larmats till platsen och arbetar med händelsen.',
  category: 'Trafikolycka',
};

test('generateArticleFromEvent creates a news article from Gemini JSON', async () => {
  let request;

  const article = await generateArticleFromEvent(policeEvent, async (nextRequest) => {
    request = nextRequest;
    return { text: JSON.stringify(generatedPayload) };
  });

  assert.equal(request.model, 'gemini-3-flash-preview');
  assert.match(request.contents, /Trafikolycka, Stockholm/);
  assert.equal(article.originalEventId, policeEvent.id);
  assert.equal(article.title, generatedPayload.title);
  assert.equal(article.location, policeEvent.location.name);
  assert.equal(article.imageUrl, `https://picsum.photos/seed/${policeEvent.id}/800/450`);
});

test('article API handler returns generated article JSON', async () => {
  const handler = createArticleApiHandler({
    generateContent: async () => ({ text: JSON.stringify(generatedPayload) }),
  });

  const response = await callHandler(handler, {
    method: 'POST',
    body: { event: policeEvent },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json');

  const article = JSON.parse(response.body);
  assert.equal(article.title, generatedPayload.title);
  assert.equal(article.originalEventId, policeEvent.id);
});

test('article API handler rejects missing event data', async () => {
  const handler = createArticleApiHandler({
    generateContent: async () => ({ text: JSON.stringify(generatedPayload) }),
  });

  const response = await callHandler(handler, {
    method: 'POST',
    body: { event: { id: 123 } },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), {
    error: 'Request body must include a police event',
  });
});

test('parseGeneratedArticle rejects malformed Gemini responses', () => {
  assert.throws(
    () => parseGeneratedArticle(JSON.stringify({ title: 'Rubrik' })),
    /Gemini response is missing lead/,
  );
});

async function callHandler(handler, { method, body }) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = method;

  const response = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk = '') {
      this.body += chunk;
    },
  };

  await handler(req, response);

  return response;
}
