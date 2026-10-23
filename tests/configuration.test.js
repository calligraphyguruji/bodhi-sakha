import test from 'node:test';
import assert from 'node:assert/strict';
import { configurationIssues } from '../lib/server/configuration.js';
import { upstreamError } from '../lib/server/ai/http.js';

test('deployment preflight detects missing prerequisites without values', () => {
  assert.deepEqual(configurationIssues({}), ['DATABASE_URL_MISSING', 'JWT_SECRET_MISSING', 'AI_KEYS_MISSING']);
  const env = { DATABASE_URL: 'private-url', JWT_SECRET: 'x'.repeat(32), GROQ_API_KEY: 'dummy-key' };
  assert.deepEqual(configurationIssues(env), []);
  assert.deepEqual(configurationIssues({ ...env, GROQ_MODEL: 'llama-3.3-70b-versatile' }), ['GROQ_MODEL_RETIRED']);
});
test('upstream classification distinguishes auth, model, quota and invalid requests', () => {
  for (const [status, detail, category] of [
    [400, 'API key not valid', 'AUTH_FAILED'], [401, '', 'AUTH_FAILED'],
    [403, '', 'AUTH_FAILED'], [404, '', 'MODEL_UNAVAILABLE'],
    [400, 'model has been decommissioned', 'MODEL_UNAVAILABLE'],
    [429, '', 'RATE_LIMITED'], [400, 'Invalid argument', 'INVALID_REQUEST'],
    [503, '', 'PROVIDER_ERROR'],
  ]) assert.equal(upstreamError(status, detail).category, category);
});
