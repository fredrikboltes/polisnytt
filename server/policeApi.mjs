const POLICE_API_PATH = '/api/police-events';
const POLICE_API_URL = 'https://polisen.se/api/events';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_LOCATION_LENGTH = 100;

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

export const createPoliceApiHandler = ({ fetchImpl = fetch } = {}) =>
  async (req, res, next) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (requestUrl.pathname !== POLICE_API_PATH) {
      next();
      return;
    }

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const locationName = requestUrl.searchParams.get('locationname');
    if (locationName !== null && (!locationName.trim() || locationName.length > MAX_LOCATION_LENGTH)) {
      sendJson(res, 400, { error: 'Invalid location name' });
      return;
    }

    const upstreamUrl = new URL(POLICE_API_URL);
    if (locationName) {
      upstreamUrl.searchParams.set('locationname', locationName);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImpl(upstreamUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Svenska Polisnyheter AI/0.0.0 (+https://github.com/fredrikboltes/polisnytt)',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Police API returned ${response.status}`);
      }

      const events = await response.json();
      if (!Array.isArray(events)) {
        throw new Error('Police API returned an invalid payload');
      }

      sendJson(res, 200, events);
    } catch (error) {
      console.error('Error fetching police events:', error);
      sendJson(res, 502, { error: 'Failed to fetch police events' });
    } finally {
      clearTimeout(timeout);
    }
  };

export const installPoliceApiMiddleware = (middlewares, options) => {
  middlewares.use(createPoliceApiHandler(options));
};
