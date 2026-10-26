import { cleanupAccount } from './account-cleanup-loader'
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


test('the real Playwright worker loads deletion outcome helper without changing session', async () => {
  const user = { username: 'e2e_runtime_cleanup', userId: 'a'.repeat(32) }
  let deletes = 0
  const proof = await cleanupAccount({ baseUrl: 'https://t.smhe.cn', username: user.username,
    password: 'synthetic', userId: user.userId, token: 'synthetic-bearer',
    fetchImpl: async (url: string, options: any) => {
      if (new URL(url).pathname === '/api/auth/me') return { status: 200, json: async () => ({ ok: true, user }) }
      expect(options.method).toBe('DELETE'); deletes++
      const { operationId } = JSON.parse(options.body)
      return { status: 200, json: async () => ({ ok: true, operationId, deleted: { accountDeleted: true } }) }
    },
  })
  expect(proof.confirmed).toBe(true); expect(deletes).toBe(1)
})
