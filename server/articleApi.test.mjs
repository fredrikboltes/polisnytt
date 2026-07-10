import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createArticleApiHandler } from './articleApi.mjs';

const sampleEvent = {
  id: 123,
  datetime: '2026-07-10 10:15:00 +02:00',
  name: '10 juli 10.15, Trafikolycka, Stockholm',
  summary: 'En trafikolycka har inträffat på E4.',
  url: 'https://polisen.se/aktuellt/handelser/2026/juli/10/10-juli-1015-trafikolycka-stockholm/',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

const createRequest = ({ method = 'POST', url = '/api/generate-article', body = {} } = {}) => {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  return req;
};

const callHandler = (handler, requestOptions) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      end(chunk) {
        if (chunk) {
          chunks.push(Buffer.from(chunk));
        }

        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      },
    };

    const next = () => reject(new Error('Unexpected next() call'));
    handler(createRequest(requestOptions), res, next).catch(reject);
  });

test('returns 503 when Gemini is not configured server-side', async () => {
  const handler = createArticleApiHandler();

  const response = await callHandler(handler, { body: { event: sampleEvent } });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: 'Gemini API key is not configured' });
});

test('returns 405 for unsupported methods', async () => {
  const handler = createArticleApiHandler({ ai: { models: {} } });

  const response = await callHandler(handler, {
    method: 'GET',
    body: { event: sampleEvent },
  });

  assert.equal(response.statusCode, 405);
  assert.deepEqual(JSON.parse(response.body), { error: 'Method not allowed' });
});

test('returns 400 for invalid police event payloads', async () => {
  const handler = createArticleApiHandler({ ai: { models: {} } });

  const response = await callHandler(handler, { body: { event: { id: 123 } } });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: 'Invalid police event payload' });
});

test('generates an article without exposing the Gemini client to the browser', async () => {
  const ai = {
    models: {
      async generateContent(request) {
        assert.equal(request.model, 'gemini-3-flash-preview');
        assert.match(request.contents, /Trafikolycka/);
        assert.equal(request.config.responseMimeType, 'application/json');

        return {
          text: JSON.stringify({
            title: 'Trafikolycka på E4',
            lead: 'Polisen rapporterar om en trafikolycka i Stockholm.',
            body: 'Räddningstjänst och polis är på plats. Trafiken påverkas i området.',
            category: 'Trafikolycka',
          }),
        };
      },
    },
  };
  const handler = createArticleApiHandler({ ai });

  const response = await callHandler(handler, { body: { event: sampleEvent } });
  const payload = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.article.originalEventId, sampleEvent.id);
  assert.equal(payload.article.location, sampleEvent.location.name);
  assert.equal(payload.article.timestamp, sampleEvent.datetime);
  assert.equal(payload.article.imageUrl, `https://picsum.photos/seed/${sampleEvent.id}/800/450`);
});
