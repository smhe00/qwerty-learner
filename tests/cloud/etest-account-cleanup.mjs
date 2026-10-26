/* eslint-env node */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { cleanupDisposableAccount } from './disposable-account-cleanup.mjs'
import { retrySafeBodyRequest } from '../../cloud-functions/_shared/safe-body-retry.js'

assert.equal(process.env.GITHUB_REF_NAME, 'edgeone-test')
const base = 'https://t.smhe.cn'
const sha = process.env.EXPECTED_SHA
assert.match(sha || '', /^[a-f0-9]{40}$/)
assert.match(process.env.GITHUB_RUN_ID || '', /^\d+$/)
async function version() {
  const r = await fetch(base + '/source-commit.txt?cleanup=' + Date.now(), { signal: AbortSignal.timeout(20000), cache: 'no-store' })
  const marker = (await r.text()).trim()
  assert.equal(r.status, 200); assert.match(marker, /^[a-f0-9]{7,40}$/); assert.ok(sha.startsWith(marker))
}
async function api(path, method = 'GET', body, token) {
  return retrySafeBodyRequest(async () => {
    const r = await fetch(base + path, { method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(40000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: r.status, body: await r.json() }
  }, { path, method })
}
await version()
const health = await api('/api/health')
assert.ok(health.body.capabilities.includes('account-delete-receipt-v1'))
const results = []
for (const mode of ['acknowledged', 'lost-response']) {
  await version()
  const username = 'e2e_cl_' + process.env.GITHUB_RUN_ID + '_' + (process.env.GITHUB_RUN_ATTEMPT || '1') + '_' + (mode === 'acknowledged' ? 'a' : 'l')
  assert.ok(username.length <= 32, 'disposable username satisfies real registration contract before network')
  const password = randomBytes(24).toString('base64url')
  const signed = await api('/api/auth/register', 'POST', { username, password, deviceId: 'qwerty-web-' + randomUUID() })
  assert.equal(signed.status, 201, 'new disposable registration; unknown outcomes are not replayed; error=' + String(signed.body?.error || 'none'))
  const { user, token } = signed.body
  const failures = []
  try {
    const posted = await api('/api/feedback', 'POST', { operationId: randomBytes(16).toString('hex'),
      title: 'CI disposable cleanup', text: 'Synthetic receipt/readback proof; safe to erase with this test account.' }, token)
    assert.equal(posted.status, 200, 'synthetic owned content setup')
  } catch (error) { failures.push(error) }
  try {
    let deletions = 0, acknowledgedDeletes = 0
    const proof = await cleanupDisposableAccount({ baseUrl: base, username, password, userId: user.userId, token,
      // Allow the server response to arrive before intentionally dropping it in this case.
      // Natural60s timeout recovery is independently exercised by the acknowledged case.
      deleteTimeoutMs: mode === 'lost-response' ? 120000 : 60000,
      fetchImpl: async (url, options) => {
        if (options.method === 'DELETE') deletions++
        const r = await fetch(url, options)
        if (options.method === 'DELETE') {
          if (r.status === 200) acknowledgedDeletes++
          if (mode === 'lost-response' && r.status === 200) {
            // Actual server DELETE completed; discard only this transport result.
            // No response body/auth data is logged or inserted into app state.
            await r.arrayBuffer()
            throw new DOMException('Synthetic acknowledgement loss after real delete', 'TimeoutError')
          }
        }
        return r
      },
    })
    assert.equal(proof.confirmed, true)
    assert.ok(deletions >= 1 && acknowledgedDeletes <= 1, 'one operation, at most one acknowledged DELETE')
    assert.ok(deletions <= 2, 'only the existing explicit pre-body safe retry is permitted')
    if (mode === 'lost-response') {
      assert.equal(acknowledgedDeletes, 1, 'explicitly discarded one real successful server response')
      assert.equal(proof.via, 'receipt')
    }
    assert.equal((await api('/api/auth/me', 'GET', undefined, token)).status, 401)
    results.push({ mode, source: sha, deleteRequests: deletions, acknowledgedDeletes, ...proof })
    console.log('CLEANUP_LIVE_PROOF', JSON.stringify(results.at(-1)))
  } catch (error) { failures.push(error); console.error('CLEANUP_LIVE_UNCONFIRMED', JSON.stringify({ mode, message: error.message, trace: error.trace || [] })) }
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '))
}
await version()
assert.equal(results.length, 2)
console.log('PASS real account cleanup and lost-response read-only recovery, exact source ' + sha)
