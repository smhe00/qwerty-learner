/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
const built = await build({ entryPoints: ['src/feedback/recovery-link.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node20' })
const { captureFeedbackRecoveryLink, pendingFeedbackRecovery, finishFeedbackRecovery } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
test('feedback fragment survives only the required bootstrap reload, without a query or learning storage write', () => {
  const values = new Map(), secret = 'f'.repeat(64)
  globalThis.sessionStorage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) }
  let location = new URL('https://q.smhe.cn/mobile?existing=1#feedback=' + secret)
  globalThis.window = { get location() { return location }, history: { state: { existing: true }, replaceState(state, _, url) {
    assert.deepEqual(state, { existing: true }); location = new URL(url, location)
  } } }
  try {
    captureFeedbackRecoveryLink()
    assert.equal(location.href, 'https://q.smhe.cn/mobile?existing=1')
    assert.equal(pendingFeedbackRecovery(), secret)
    captureFeedbackRecoveryLink()
    assert.equal(pendingFeedbackRecovery(), secret)
    finishFeedbackRecovery()
    assert.equal(values.size, 0)
    location.hash = 'unrelated=keep'
    captureFeedbackRecoveryLink()
    assert.equal(location.hash, '#unrelated=keep'); assert.equal(values.size, 0)
    location.hash = 'feedback=invalid'
    captureFeedbackRecoveryLink()
    assert.equal(location.hash, '#feedback=invalid')
  } finally { delete globalThis.window; delete globalThis.sessionStorage }
})
