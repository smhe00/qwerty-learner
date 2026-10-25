/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const folder = await mkdtemp(join(tmpdir(), 'qwerty-quick-sync-'))
const outfile = join(folder, 'quick-entry.mjs')
await build({
  entryPoints: ['src/sync/quick-sync-entry.ts'], outfile,
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  logLevel: 'silent',
  define: {
    REACT_APP_DEPLOY_ENV: '"edgeone-test"',
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC': '"true"',
    'import.meta.env.VITE_QWERTY_SYNC_DISABLED': '"false"',
  },
  plugins: [{
    name: 'isolated-ui-ports',
    setup(builder) {
      builder.onResolve({ filter: /\/auth$/ }, (args) =>
        args.importer.endsWith('quick-sync-entry.ts') ? { path: 'auth', namespace: 'isolated' } : undefined)
      builder.onLoad({ filter: /^auth$/, namespace: 'isolated' }, () =>
        ({ contents: 'export const loadAuth = () => globalThis.__quickAuth', loader: 'js' }))
      builder.onResolve({ filter: /^@\/learn\/persistence$/ }, () => ({ path: 'flush', namespace: 'isolated' }))
      builder.onLoad({ filter: /^flush$/, namespace: 'isolated' }, () =>
        ({ contents: 'export const flushLearnPersistence = () => globalThis.__quickFlush()', loader: 'js' }))
    },
  }],
})
const api = await import(pathToFileURL(outfile).href)
const state = new Map(), local = new Map(), navigated = [], sequence = []
globalThis.sessionStorage = {
  getItem: key => state.get(key) ?? null,
  setItem: (key, val) => state.set(key, String(val)),
  removeItem: key => state.delete(key),
}
globalThis.localStorage = {
  getItem: key => local.get(key) ?? null,
  setItem: (key, val) => local.set(key, String(val)),
  removeItem: key => local.delete(key),
}
globalThis.navigator = { onLine: true }
globalThis.window = {
  location: { replace: p => { sequence.push('navigate'); navigated.push(p) } },
  requestAnimationFrame: () => undefined,
  dispatchEvent: () => undefined,
}
const id = 'synthetic-account'
function reset() {
  state.clear(); local.clear(); navigated.length = 0; sequence.length = 0
  globalThis.__quickAuth = { user: { userId: id, username: 'fake' }, token: 'synthetic', expiresAt: Math.floor(Date.now() / 1000) + 600 }
  globalThis.__quickFlush = async () => { sequence.push('flush') }
  navigator.onLine = true
}
test('entry flushes writes and navigates only to the guarded pre-mount S2 route', async () => {
  reset()
  await api.startQuickSync('/learn', () => sequence.push('pause'))
  assert.deepEqual(sequence, ['pause', 'flush', 'navigate'])
  assert.deepEqual(navigated, ['/?s2-sync=run&quick-sync=1'])
  assert.equal(api.getQuickSyncIntent(id).target, '/learn')
  assert.equal(api.quickSyncReturnPath(id), '/learn?quick-sync-return=1')
})
test('local persistence failure prevents navigation and does not issue a sync intent', async () => {
  reset()
  globalThis.__quickFlush = async () => { throw Error('local writer still pending') }
  await assert.rejects(api.startQuickSync('/mobile/study'))
  assert.deepEqual(navigated, [])
  assert.equal(api.getQuickSyncIntent(id), null)
})
test('auth change or offline status prevents any cloud/navigation work', async () => {
  reset()
  navigator.onLine = false
  await assert.rejects(api.startQuickSync('/mobile'))
  assert.deepEqual(navigated, [])
  navigator.onLine = true
  globalThis.__quickFlush = async () => {
    globalThis.__quickAuth = { ...globalThis.__quickAuth, token: 'replacement' }
  }
  await assert.rejects(api.startQuickSync('/typing'))
  assert.deepEqual(navigated, [])
})
test('success notice requires explicit completion and stays account-scoped', async () => {
  reset()
  await api.startQuickSync('/mobile')
  assert.equal(api.finalizeQuickSync(id, { kind: 'ok', message: '已同步' }), '/mobile?quick-sync-return=1')
  assert.ok(api.lastQuickSyncAt(id) > 0)
  assert.equal(api.takeQuickSyncNotice('different-account'), null)
  assert.equal(api.takeQuickSyncNotice(id), null)
  assert.equal(api.getQuickSyncIntent(id), null)
})
test('confirmed noop/push success is visible only to its original account', async () => {
  reset()
  await api.startQuickSync('/typing')
  assert.equal(api.finalizeQuickSync(id, { kind: 'ok', message: '本机云端一致。' }), '/typing?quick-sync-return=1')
  assert.deepEqual(api.takeQuickSyncNotice(id), { kind: 'ok', message: '本机云端一致。' })
  assert.equal(api.takeQuickSyncNotice(id), null)
})
test('a recovered Pull is success only after the precise durable replay receipt', async () => {
  reset()
  await api.startQuickSync('/mobile/study')
  api.markQuickSyncPullStaged(id)
  assert.equal(api.quickSyncReturnPath(id), '/mobile/study?quick-sync-return=1')
  assert.equal(api.finishQuickSyncRecovery(id, '已完成云端学习数据安全恢复。'), true)
  assert.deepEqual(api.takeQuickSyncNotice(id), { kind: 'ok', message: '学习记录已安全同步。' })
  reset()
  await api.startQuickSync('/learn')
  api.markQuickSyncPullStaged(id)
  assert.equal(api.finishQuickSyncRecovery(id, null), true)
  assert.deepEqual(api.takeQuickSyncNotice(id), { kind: 'unknown', message: '同步结果暂未确认，本机学习记录仍保留。' })
  assert.equal(api.lastQuickSyncAt(id), null)
})
test('malformed destinations are rejected before any navigation', async () => {
  reset()
  await assert.rejects(api.startQuickSync('https://attacker.invalid/'))
  assert.deepEqual(navigated, [])
})
await rm(folder, { recursive: true, force: true })
