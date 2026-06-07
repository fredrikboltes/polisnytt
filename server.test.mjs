import assert from 'node:assert/strict';
import test from 'node:test';
import { buildArticle, generateNewsArticle } from './server.mjs';

const policeEvent = {
  id: 123,
  datetime: '2026-06-07 12:00:00 +02:00',
  name: 'Trafikolycka, Stockholm',
  summary: 'En personbil har kört av vägen.',
  url: 'https://polisen.se/aktuellt/handelser/example',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

test('buildArticle preserves police event identity and generated content', () => {
  const article = buildArticle(
    policeEvent,
    {
      title: 'Bil körde av vägen',
      lead: 'Polisen ryckte ut efter en trafikolycka.',
      body: 'En personbil körde av vägen under söndagen.',
      category: 'Trafikolycka',
    },
    () => 987654321,
  );

  assert.deepEqual(article, {
    id: 'article-123-987654321',
    originalEventId: 123,
    title: 'Bil körde av vägen',
    lead: 'Polisen ryckte ut efter en trafikolycka.',
    body: 'En personbil körde av vägen under söndagen.',
    category: 'Trafikolycka',
    location: 'Stockholm',
    timestamp: '2026-06-07 12:00:00 +02:00',
    imageUrl: 'https://picsum.photos/seed/123/800/450',
  });
});

test('generateNewsArticle uses injected server-side Gemini client', async () => {
  const calls = [];
  const fakeAi = {
    models: {
      async generateContent(request) {
        calls.push(request);
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

  const article = await generateNewsArticle(policeEvent, {
    ai: fakeAi,
    now: () => 111,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'gemini-3-flash-preview');
  assert.equal(calls[0].config.responseMimeType, 'application/json');
  assert.match(calls[0].contents, /Trafikolycka, Stockholm/);
  assert.equal(article?.id, 'article-123-111');
  assert.equal(article?.title, 'Rubrik');
});

test('generateNewsArticle returns null for invalid Gemini payloads', async () => {
  const article = await generateNewsArticle(policeEvent, {
    logger: { error() {} },
    ai: {
      models: {
        async generateContent() {
          return { text: JSON.stringify({ title: 'Saknar fält' }) };
        },
      },
    },
  });

  assert.equal(article, null);
});
