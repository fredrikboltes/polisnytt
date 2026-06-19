import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createGenerateArticleHandler } from './articleApi.mjs';

const invokeHandler = async ({ apiKey, method = 'POST', body = '' } = {}) => {
  const req = new PassThrough();
  req.method = method;

  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      this.body = payload;
    },
  };

  const handler = createGenerateArticleHandler({ apiKey });
  const promise = handler(req, res);
  req.end(body);
  await promise;

  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: JSON.parse(res.body),
  };
};

test('rejects non-POST article generation requests', async () => {
  const response = await invokeHandler({ method: 'GET' });

  assert.equal(response.statusCode, 405);
  assert.deepEqual(response.body, { error: 'Method not allowed' });
});

test('does not accept article generation when the Gemini key is missing', async () => {
  const response = await invokeHandler();

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'GEMINI_API_KEY is not configured' });
});

test('rejects invalid article generation payloads before calling Gemini', async () => {
  const response = await invokeHandler({
    apiKey: 'test-api-key',
    body: JSON.stringify({ event: { id: 123 } }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: 'Invalid police event payload' });
});

test('rejects oversized article generation payloads', async () => {
  const response = await invokeHandler({
    apiKey: 'test-api-key',
    body: 'x'.repeat(1024 * 1024 + 1),
  });

  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.body, { error: 'Request body too large' });
});
