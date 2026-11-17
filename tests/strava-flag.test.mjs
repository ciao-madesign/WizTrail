import test from 'node:test';
import assert from 'node:assert/strict';
import { mockReq, mockRes, stubFetch, setEnv } from './helpers.mjs';
import callback from '../api/strava/callback.js';
import activities from '../api/strava/activities.js';
import activity from '../api/strava/activity.js';

const casi = [
  ['callback', callback, { query: { code: 'abc123' } }],
  ['activities', activities, { headers: { authorization: 'Bearer x' } }],
  ['activity', activity, { query: { id: '123' }, headers: { authorization: 'Bearer x' } }],
];

for (const [nome, handler, req] of casi) {
  test(`Strava spenta (default): ${nome} risponde 503 italiano senza chiamare Strava ne' Redis`, async () => {
    const ripristina = setEnv({ STRAVA_ENABLED: undefined, STRAVA_CLIENT_ID: 'id', STRAVA_CLIENT_SECRET: 's' });
    const f = stubFetch();
    try {
      const res = mockRes();
      await handler(mockReq(req), res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.code, 'FEATURE_UNAVAILABLE');
      assert.equal(res.body.feature, 'strava');
      assert.match(res.body.error, /non è ancora disponibile/);
      assert.equal(f.chiamate.length, 0, 'nessun fetch consentito con flag spento');
    } finally { f.ripristina(); ripristina(); }
  });
}

test('Strava con STRAVA_ENABLED=true: il flusso normale riprende (senza token -> 401)', async () => {
  const ripristina = setEnv({ STRAVA_ENABLED: 'true', UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
  const f = stubFetch();
  try {
    const res = mockRes();
    await activities(mockReq({}), res);
    assert.equal(res.statusCode, 401);
  } finally { f.ripristina(); ripristina(); }
});
