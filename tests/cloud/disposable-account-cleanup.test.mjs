/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanupDisposableAccount } from './disposable-account-cleanup.mjs'
const user = { userId: 'a'.repeat(32), username: 'e2e_cleanup_123' }
const token = 'synthetic-session-'.repeat(5)
function fixture(mode) {
  let clock = 0, operationId, reads = 0
  const calls = []
  return { calls, options: { baseUrl: 'https://t.smhe.cn', username: user.username, userId: user.userId,
    password: 'synthetic-password', token, now: () => clock, pause: async ms => { clock += ms }, recoveryMs: 5, pollMs: 1,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname; calls.push(options.method + ' ' + path)
      const reply = (status, body) => ({ status, json: async () => body })
      if (path === '/api/auth/me') return reply(200, { ok: true, user })
      if (options.method === 'DELETE') {
        operationId = JSON.parse(options.body).operationId
        if (mode === 'ack') return reply(200, { ok: true, operationId, deleted: { accountDeleted: true } })
        throw new DOMException('dropped response', 'TimeoutError')
      }
      if (path.endsWith('deletion-status')) {
        reads++
        if (mode === 'missing') return reply(404, { ok: false })
        return reply(200, { ok: true, operationId, userId: mode === 'wrong-owner' ? 'b'.repeat(32) : user.userId,
          state: mode === 'pending' || (mode === 'slow' && reads < 3) ? 'pending' : 'completed', deleted: { accountDeleted: true } })
      }
      throw Error('unexpected auth/mutation after deletion')
    },
  } }
}
for (const mode of ['ack', 'dropped', 'slow']) test('cleanup ' + mode + ' uses exactly one DELETE and no later login', async () => {
  const f = fixture(mode), result = await cleanupDisposableAccount(f.options)
  assert.equal(result.confirmed, true); assert.equal(result.via, mode === 'ack' ? 'delete-response' : 'receipt')
  assert.equal(f.calls.filter(x => x.startsWith('DELETE')).length, 1)
  assert.equal(f.calls.some(x => x.includes('/auth/login')), false)
})
for (const mode of ['pending', 'missing', 'wrong-owner']) test('cleanup ' + mode + ' remains failed without replay', async () => {
  const f = fixture(mode)
  await assert.rejects(cleanupDisposableAccount(f.options), mode === 'wrong-owner' ? /identity mismatch/ : /unconfirmed/)
  assert.equal(f.calls.filter(x => x.startsWith('DELETE')).length, 1)
  assert.equal(f.calls.some(x => x.includes('/auth/login')), false)
})
test('cleanup refuses real/admin identity and refuses mismatched ordinary owner before DELETE', async () => {
  const f = fixture('ack')
  await assert.rejects(cleanupDisposableAccount({ ...f.options, username: 'admin' }), /Refusing/)
  await assert.rejects(cleanupDisposableAccount({ ...f.options, userId: 'b'.repeat(32) }), /owner mismatch/)
  assert.equal(f.calls.filter(x => x.startsWith('DELETE')).length, 0)
})

for (const outcome of ['timeout', 'server-error', 'wrong-owner']) test('pre-delete authentication ' + outcome + ' retains phase and never retries login or DELETE', async () => {
  const calls = []
  await assert.rejects(cleanupDisposableAccount({ baseUrl:'https://t.smhe.cn', username:user.username,
    password:'synthetic-password', userId:user.userId, fetchImpl:async (url,options) => {
      calls.push(options.method+' '+new URL(url).pathname)
      if(outcome==='timeout') throw new DOMException('lost login response','TimeoutError')
      return {status:outcome==='server-error'?503:200,json:async()=>({error:'synthetic_failure',user:{...user,userId:'b'.repeat(32)},token})}
    } }),error=>{
      assert.equal(error.trace.length,1)
      assert.equal(error.trace[0].phase,'owner-check')
      assert.doesNotMatch(JSON.stringify(error.trace),/synthetic-password|synthetic-session/)
      return true
    })
  assert.deepEqual(calls,['POST /api/auth/login'])
})
