import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  articleFromGeminiResponse,
  createApiHandler,
  generateArticle,
  parseEnv,
} from '../server.mjs';

const sampleEvent = {
  id: 123,
  datetime: '2026-05-29 10:15',
  name: 'Trafikolycka, Stockholm',
  summary: 'En trafikolycka har inträffat på E4.',
  url: 'https://polisen.se/aktuellt/handelser/123',
  type: 'Trafikolycka',
  location: {
    name: 'Stockholm',
    gps: '59.3293,18.0686',
  },
};

const geminiText = JSON.stringify({
  title: 'Olycka på E4 i Stockholm',
  lead: 'Polisen larmades till en trafikolycka på E4 under förmiddagen.',
  body: 'Händelsen inträffade under fredagen och polis arbetar på platsen.',
  category: 'Trafikolycka',
});

function listen(handler) {
  const server = createServer(handler);

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
      });
    });
  });
}

test('parseEnv supports local env file syntax without overwriting process values', () => {
  assert.deepEqual(
    parseEnv('GEMINI_API_KEY="local-secret"\nexport API_KEY=legacy-secret\n# ignored\nEMPTY=\n'),
    {
      GEMINI_API_KEY: 'local-secret',
      API_KEY: 'legacy-secret',
      EMPTY: '',
    },
  );
});

test('generateArticle maps Gemini JSON into a news article', async () => {
  let prompt = '';
  const fakeAi = {
    models: {
      async generateContent(request) {
        prompt = request.contents;
        return { text: geminiText };
      },
    },
  };

  const article = await generateArticle(sampleEvent, fakeAi, () => 42);

  assert.match(prompt, /Trafikolycka, Stockholm/);
  assert.equal(article.id, 'article-123-42');
  assert.equal(article.originalEventId, 123);
  assert.equal(article.title, 'Olycka på E4 i Stockholm');
  assert.equal(article.location, 'Stockholm');
  assert.equal(article.imageUrl, 'https://picsum.photos/seed/123/800/450');
});

test('articleFromGeminiResponse rejects incomplete Gemini output', () => {
  assert.throws(
    () => articleFromGeminiResponse(JSON.stringify({ title: 'Saknar fält' }), sampleEvent),
    /missing lead/,
  );
});

test('POST /api/generate-article returns generated article JSON', async () => {
  const handler = createApiHandler({
    ai: {
      models: {
        async generateContent() {
          return { text: geminiText };
        },
      },
    },
    now: () => 99,
  });
  const { server, baseUrl } = await listen(handler);

  try {
    const response = await fetch(`${baseUrl}/api/generate-article`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: sampleEvent }),
    });

    assert.equal(response.status, 200);
    const article = await response.json();
    assert.equal(article.id, 'article-123-99');
    assert.equal(article.category, 'Trafikolycka');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('client code does not import Gemini SDK or define Gemini secrets', async () => {
  const [indexHtml, viteConfig, geminiService] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.ts', import.meta.url), 'utf8'),
    readFile(new URL('../services/geminiService.ts', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(indexHtml, /@google\/genai|GEMINI_API_KEY|API_KEY/);
  assert.doesNotMatch(viteConfig, /GEMINI_API_KEY|process\.env|loadEnv/);
  assert.doesNotMatch(geminiService, /@google\/genai|process\.env/);
  assert.match(geminiService, /\/api\/generate-article/);
});
