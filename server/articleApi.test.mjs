import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  createNewsArticle,
  generateNewsArticleFromEvent,
  handleGenerateArticleRequest,
  isValidPoliceEvent,
} from './articleApi.mjs';

const event = {
  id: 123,
  datetime: '2026-06-28 12:00:00 +02:00',
  name: '28 juni 12.00, Trafikolycka, Stockholm',
  summary: 'En trafikolycka har inträffat på E4.',
  url: 'https://polisen.se/aktuellt/handelser/2026/juni/28/28-juni-1200-trafikolycka-stockholm/',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

const articleFields = {
  title: 'Olycka på E4 i Stockholm',
  lead: 'Polisen rapporterar om en trafikolycka på E4.',
  body: 'Räddningstjänst och polis har larmats till platsen.',
  category: 'Trafikolycka',
};

const createRequest = ({ method = 'POST', body = { event } } = {}) => {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = method;
  return req;
};

const createResponse = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(payload = '') {
      this.body = payload;
    },
  };

  return res;
};

test('validates the police event shape before generation', () => {
  assert.equal(isValidPoliceEvent(event), true);
  assert.equal(isValidPoliceEvent({ ...event, location: null }), false);
});

test('creates a complete news article from Gemini JSON fields', () => {
  const article = createNewsArticle(event, articleFields, () => 987);

  assert.deepEqual(article, {
    id: 'article-123-987',
    originalEventId: 123,
    title: articleFields.title,
    lead: articleFields.lead,
    body: articleFields.body,
    category: articleFields.category,
    location: 'Stockholm',
    timestamp: event.datetime,
    imageUrl: 'https://picsum.photos/seed/123/800/450',
  });
});

test('generates through an injected Gemini client without requiring browser secrets', async () => {
  let prompt = '';
  const client = {
    models: {
      async generateContent(request) {
        prompt = request.contents;
        return { text: JSON.stringify(articleFields) };
      },
    },
  };

  const article = await generateNewsArticleFromEvent(event, {
    client,
    now: () => 111,
  });

  assert.match(prompt, /Trafikolycka/);
  assert.equal(article.id, 'article-123-111');
  assert.equal(article.title, articleFields.title);
});

test('article API rejects unsupported methods', async () => {
  const req = createRequest({ method: 'GET' });
  const res = createResponse();

  await handleGenerateArticleRequest(req, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
  assert.deepEqual(JSON.parse(res.body), { error: 'Method not allowed' });
});

test('article API returns generated articles for valid requests', async () => {
  const req = createRequest();
  const res = createResponse();

  await handleGenerateArticleRequest(req, res, {
    generateArticle: async (receivedEvent) => {
      assert.deepEqual(receivedEvent, event);
      return createNewsArticle(receivedEvent, articleFields, () => 222);
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).article.id, 'article-123-222');
});

test('article API rejects invalid event payloads before generation', async () => {
  const req = createRequest({ body: { event: { id: 123 } } });
  const res = createResponse();
  let generated = false;

  await handleGenerateArticleRequest(req, res, {
    generateArticle: async () => {
      generated = true;
    },
  });

  assert.equal(generated, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'Invalid police event' });
});
