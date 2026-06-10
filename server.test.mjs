import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createApiHandler } from './server.mjs';

const sampleEvent = {
  id: 123,
  datetime: '2026-06-10 10:30',
  name: '10 juni 10.30, Trafikolycka, Stockholm',
  summary: 'En trafikolycka har inträffat.',
  url: 'https://polisen.se/aktuellt/handelser/test',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

async function withApiServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('police events are fetched server-side with a service user agent', async () => {
  const seen = {};
  const handler = createApiHandler({
    fetchImpl: async (url, options) => {
      seen.url = url.toString();
      seen.headers = options.headers;
      return new Response(JSON.stringify([sampleEvent]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await withApiServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/police-events?locationname=Stockholm`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [sampleEvent]);
  });

  assert.equal(seen.url, 'https://polisen.se/api/events?locationname=Stockholm');
  assert.match(seen.headers['User-Agent'], /^Svenska Polisnyheter AI\/1\.0/);
});

test('article generation returns server-created articles from Gemini output', async () => {
  const seen = {};
  const fakeAi = {
    models: {
      generateContent: async (request) => {
        seen.request = request;
        return {
          text: JSON.stringify({
            title: 'Ny rubrik',
            lead: 'Kort ingress',
            body: 'Artikeltext',
            category: 'Trafik',
          }),
        };
      },
    },
  };

  const handler = createApiHandler({
    ai: fakeAi,
    now: () => 42,
  });

  await withApiServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate-article`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: sampleEvent }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      id: 'article-123-42',
      originalEventId: 123,
      title: 'Ny rubrik',
      lead: 'Kort ingress',
      body: 'Artikeltext',
      category: 'Trafik',
      location: 'Stockholm',
      timestamp: '2026-06-10 10:30',
      imageUrl: 'https://picsum.photos/seed/123/800/450',
    });
  });

  assert.match(seen.request.contents, /En trafikolycka har inträffat/);
  assert.equal(seen.request.config.responseMimeType, 'application/json');
});

test('invalid article generation payload is rejected before Gemini is called', async () => {
  let geminiCalled = false;
  const handler = createApiHandler({
    ai: {
      models: {
        generateContent: async () => {
          geminiCalled = true;
        },
      },
    },
  });

  await withApiServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate-article`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: { id: 123 } }),
    });

    assert.equal(response.status, 400);
    assert.equal(geminiCalled, false);
  });
});
