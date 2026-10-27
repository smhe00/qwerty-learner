/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

// Execute the real live driver against an intercepted network. In particular,
// a missing login acknowledgement must not trigger a new cleanup login.
for (const outcome of ['timeout', 'unknown-500', 'acknowledged']) test('M3 live cleanup respects login outcome: ' + outcome, async () => {
  const savedFetch = globalThis.fetch
  const names = ['GITHUB_REF_NAME', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'QWERTY_SYNC_BASE_URL']
  const savedEnv = Object.fromEntries(names.map(name => [name, process.env[name]]))
  Object.assign(process.env, { GITHUB_REF_NAME: 'edgeone-test', GITHUB_RUN_ID: '1234567890',
    GITHUB_RUN_ATTEMPT: '1', QWERTY_SYNC_BASE_URL: 'https://t.smhe.cn' })
  const sent = []
  const user = { userId: 'a'.repeat(32), username: 'e2e_m3_1234567890_1' }
  let loginCount = 0, currentToken = 'synthetic-original-token-never-valid'
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname, method = options.method || 'GET'
    sent.push(method + ' ' + path)
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status })
    if (path === '/api/health') return reply({ authMode: 'single-active-session' })
    if (path === '/api/auth/register') return reply({ token: currentToken, user }, 201)
    if (path === '/api/sync/events/v2/verify-set') return reply({ verified: true, uniqueAttemptCount: 3,
      duplicateAttemptCount: 1, deviceCount: 2, convergenceComplete: false, publishReady: false, evidenceSha256: 'c'.repeat(64) })
    if (path === '/api/sync/events/v2' && method === 'GET') return reply({ batch: { sha256: 'b'.repeat(64) } })
    if (path === '/api/sync/events/v2') {
      const body = JSON.parse(options.body)
      return reply({ deviceId: body.deviceId, sequence: body.sequence, batchId: body.batchId, sha256: 'b'.repeat(64) }, 201)
    }
    if (path === '/api/auth/login') {
      if (outcome === 'acknowledged') {
        currentToken = 'synthetic-verified-session-never-valid-' + ++loginCount
        return reply({ token: currentToken, user })
      }
      if (outcome === 'timeout') throw new DOMException('Synthetic response loss', 'TimeoutError')
      return reply({ error: 'internal_error' }, 500)
    }
    if (path === '/api/auth/me') return options.headers.Authorization === 'Bearer ' + currentToken
      ? reply({ user }) : reply({ error: 'session_revoked' }, 401)
    if (path === '/api/auth/account' && method === 'DELETE') return reply({ ok: true,
      operationId: JSON.parse(options.body).operationId, deleted: { accountDeleted: true } })
    throw Error('Unexpected network operation ' + method + ' ' + path)
  }
  try {
    const bundled = await build({ entryPoints: ['tests/cloud/etest-multi-device-pilot.mjs'], bundle: true,
      platform: 'node', format: 'esm', target: 'node20', write: false })
    let failure
    try { await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64') + '#' + outcome) }
    catch (error) { failure = error }
    if (outcome === 'acknowledged') {
      assert.equal(failure, undefined)
      assert.equal(sent.filter(x => x === 'POST /api/auth/login').length, 2, 'only the two planned device logins')
      assert.equal(sent.filter(x => x === 'DELETE /api/auth/account').length, 1, 'verified session can clean its fixture')
      return
    }
    assert.ok(failure instanceof AggregateError)
    assert.equal(sent.filter(x => x === 'POST /api/auth/login').length, 1, 'unknown login is not replaced by a cleanup session')
    assert.equal(sent.filter(x => x === 'DELETE /api/auth/account').length, 0)
    assert.equal(sent.filter(x => x === 'GET /api/auth/me').length, 0, 'do not start cleanup after unknown login')
    assert.ok(failure.errors.some(error => error.message.includes('prior login outcome unknown')))
  } finally {
    globalThis.fetch = savedFetch
    for (const name of names) {
      if (savedEnv[name] === undefined) delete process.env[name]
      else process.env[name] = savedEnv[name]
    }
  }
})
