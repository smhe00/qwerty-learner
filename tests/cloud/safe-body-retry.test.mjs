/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { retrySafeBodyRequest } from '../../cloud-functions/_shared/safe-body-retry.js'

const rejection = { status: 503, body: { error: 'request_body_unavailable', details: { stage: 'request-body', safeToRetry: true } } }
const noPause = async () => undefined

for (const [path, method] of [['/api/auth/register', 'POST'], ['/api/auth/login', 'POST'],
  ['/api/auth/change-password', 'POST'], ['/api/auth/account', 'DELETE']]) {
  test(path + ' retries exactly once only after explicit pre-business rejection', async () => {
    let sent = 0
    const answer = await retrySafeBodyRequest(async () => ++sent === 1 ? rejection : { status: 200, body: { ok: true } },
      { path, method, pause: noPause })
    assert.equal(answer.status, 200)
    assert.equal(sent, 2)
    sent = 0
    await retrySafeBodyRequest(async () => { sent++; return rejection }, { path, method, pause: noPause })
    assert.equal(sent, 2)
  })
}

test('unknown 500/503, malformed proof, invalid credentials and ambiguous commits are never replayed', async () => {
  const cases = [
    ['/api/auth/register', 'POST', { status: 500, body: {} }],
    ['/api/auth/register', 'POST', { status: 503, body: { error: 'internal_error' } }],
    ['/api/auth/register', 'POST', { status: 503, body: { error: 'request_body_unavailable', details: { stage: 'request-body' } } }],
    ['/api/auth/login', 'POST', { status: 401, body: { error: 'incorrect_password' } }],
    ['/api/sync/v2', 'PUT', rejection],
    ['/api/sync/v2/commit', 'POST', rejection],
    ['/api/auth/account', 'POST', rejection],
  ]
  for (const [path, method, value] of cases) {
    let sent = 0
    const result = await retrySafeBodyRequest(async () => { sent++; return value }, { path, method, pause: noPause })
    assert.equal(sent, 1)
    assert.equal(result, value)
  }
  let sent = 0
  const original = new TypeError('network response lost after possible commit')
  await assert.rejects(retrySafeBodyRequest(async () => { sent++; throw original },
    { path: '/api/auth/register', method: 'POST', pause: noPause }), error => error === original)
  assert.equal(sent, 1)
})
