import { loadBodyPolicy } from './body-policy-loader'
import { expect, test } from '@playwright/test'

test('the real Playwright worker can execute the shared ESM policy on its configured Node runtime', async () => {
  const policy = await loadBodyPolicy()
  let sent = 0
  const answer = await policy.retrySafeBodyRequest(async () => {
    sent++
    return sent === 1
      ? { status: 503, body: { error: 'request_body_unavailable', details: { stage: 'request-body', safeToRetry: true } } }
      : { status: 200, body: { ok: true } }
  }, { path: '/api/auth/login', method: 'POST', pause: async () => undefined })
  expect(sent).toBe(2)
  expect(answer.status).toBe(200)
  expect(policy.safeBodyReadFailure('/api/sync/v2', 'PUT', 503, {
    error: 'request_body_unavailable', details: { stage: 'request-body', safeToRetry: true },
  })).toBe(false)
  console.log('Shared policy runtime:', process.version)
})
