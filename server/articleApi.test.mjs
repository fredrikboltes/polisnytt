import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { generateArticleFromEvent, setupArticleApi } from './articleApi.mjs';

const policeEvent = {
  id: 123,
  datetime: '2026-06-20 10:15:00',
  name: 'Trafikolycka, Stockholm',
  summary: 'En trafikolycka har inträffat på E4.',
  url: 'https://polisen.se/aktuellt/handelser/',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

const createFakeAi = (article = {}) => {
  const fakeAi = {
    calls: [],
    models: {
      async generateContent(request) {
        fakeAi.calls.push(request);
        return {
          text: JSON.stringify({
            title: 'Olycka på E4',
            lead: 'Polisen rapporterar om en trafikolycka i Stockholm.',
            body: 'Händelsen inträffade under förmiddagen och trafiken påverkades.',
            category: 'Trafikolycka',
            ...article,
          }),
        };
      },
    },
  };

  return fakeAi;
};

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = new Map();
    this.body = '';
  }

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
  }

  getHeader(name) {
    return this.headers.get(name.toLowerCase());
  }

  _write(chunk, _encoding, callback) {
    this.body += chunk.toString();
    callback();
  }
}

const createRequest = (method, body) => {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  const request = Readable.from(chunks);
  request.method = method;
  return request;
};

const registerHandler = (options) => {
  let routePath;
  let handler;
  setupArticleApi({
    use(path, middleware) {
      routePath = path;
      handler = middleware;
    },
  }, options);
  return { routePath, handler };
};

test('generateArticleFromEvent creates a NewsArticle using a server-side AI client', async () => {
  const fakeAi = createFakeAi();

  const article = await generateArticleFromEvent(policeEvent, {
    ai: fakeAi,
    now: () => 456,
  });

  assert.equal(article.id, 'article-123-456');
  assert.equal(article.originalEventId, policeEvent.id);
  assert.equal(article.location, 'Stockholm');
  assert.equal(article.imageUrl, 'https://picsum.photos/seed/123/800/450');
  assert.equal(fakeAi.calls.length, 1);
  assert.equal(fakeAi.calls[0].model, 'gemini-3-flash-preview');
  assert.match(fakeAi.calls[0].contents, /Trafikolycka, Stockholm/);
});

test('article API returns generated articles for valid POST requests', async () => {
  const fakeAi = createFakeAi();
  const { routePath, handler } = registerHandler({
    ai: fakeAi,
    now: () => 789,
  });
  assert.equal(routePath, '/api/generate-article');

  const response = new MockResponse();
  const finished = once(response, 'finish');
  await handler(createRequest('POST', { event: policeEvent }), response);
  await finished;

  assert.equal(response.statusCode, 200);
  assert.equal(response.getHeader('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(response.body), {
    id: 'article-123-789',
    originalEventId: 123,
    title: 'Olycka på E4',
    lead: 'Polisen rapporterar om en trafikolycka i Stockholm.',
    body: 'Händelsen inträffade under förmiddagen och trafiken påverkades.',
    category: 'Trafikolycka',
    location: 'Stockholm',
    timestamp: '2026-06-20 10:15:00',
    imageUrl: 'https://picsum.photos/seed/123/800/450',
  });
});

test('article API rejects invalid events before calling Gemini', async () => {
  const fakeAi = createFakeAi();
  const { handler } = registerHandler({ ai: fakeAi });

  const response = new MockResponse();
  const finished = once(response, 'finish');
  await handler(createRequest('POST', { event: { id: 'not-a-number' } }), response);
  await finished;

  assert.equal(response.statusCode, 400);
  assert.equal(fakeAi.calls.length, 0);
  assert.deepEqual(JSON.parse(response.body), {
    error: 'Missing or invalid police event',
  });
});

test('article API only accepts POST requests', async () => {
  const { handler } = registerHandler({ ai: createFakeAi() });

  const response = new MockResponse();
  const finished = once(response, 'finish');
  await handler(createRequest('GET'), response);
  await finished;

  assert.equal(response.statusCode, 405);
  assert.equal(response.getHeader('Allow'), 'POST');
  assert.deepEqual(JSON.parse(response.body), {
    error: 'Method not allowed',
  });
});
