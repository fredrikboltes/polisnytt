import assert from 'node:assert/strict';
import test from 'node:test';
import { createPoliceApiHandler } from './policeApi.mjs';

const callHandler = (handler, { method = 'GET', url = '/api/police-events' } = {}) =>
  new Promise((resolve, reject) => {
    const req = { method, url };
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
    Promise.resolve(handler(req, res, next)).catch(reject);
  });

test('proxies county-filtered events through the server', async () => {
  const events = [{ id: 123, location: { name: 'Västra Götaland' } }];
  const fetchImpl = async (url, options) => {
    assert.equal(url.origin, 'https://polisen.se');
    assert.equal(url.pathname, '/api/events');
    assert.equal(url.searchParams.get('locationname'), 'Västra Götaland');
    assert.equal(options.headers.Accept, 'application/json');
    assert.match(options.headers['User-Agent'], /polisnyheter/i);
    assert.ok(options.signal);

    return {
      ok: true,
      async json() {
        return events;
      },
    };
  };
  const handler = createPoliceApiHandler({ fetchImpl });

  const response = await callHandler(handler, {
    url: '/api/police-events?locationname=V%C3%A4stra+G%C3%B6taland',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), events);
});

test('rejects unsupported methods without calling upstream', async () => {
  const handler = createPoliceApiHandler({
    fetchImpl: async () => {
      throw new Error('Unexpected upstream request');
    },
  });

  const response = await callHandler(handler, { method: 'POST' });

  assert.equal(response.statusCode, 405);
  assert.deepEqual(JSON.parse(response.body), { error: 'Method not allowed' });
});

test('rejects invalid location names without calling upstream', async () => {
  const handler = createPoliceApiHandler({
    fetchImpl: async () => {
      throw new Error('Unexpected upstream request');
    },
  });

  const response = await callHandler(handler, {
    url: '/api/police-events?locationname=%20%20',
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: 'Invalid location name' });
});

test('reports upstream failures instead of returning an empty event list', async () => {
  const handler = createPoliceApiHandler({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await callHandler(handler);

    assert.equal(response.statusCode, 502);
    assert.deepEqual(JSON.parse(response.body), { error: 'Failed to fetch police events' });
  } finally {
    console.error = originalConsoleError;
  }
});
