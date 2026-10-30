import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'

const temp = mkdtempSync(join(tmpdir(), 'account-journey-'))
after(() => rmSync(temp, { recursive: true, force: true }))
async function compile(environment) {
  const output = join(temp, environment + '.mjs')
  await build({ entryPoints: ['src/sync/account-journey.ts'], outfile: output, bundle: true, platform: 'node', target: 'node20', format: 'esm',
    define: { REACT_APP_DEPLOY_ENV: JSON.stringify(environment) } })
  return import(pathToFileURL(output).href)
}
const edgeone = await compile('edgeone'), pages = await compile('pages')
function fixture(pathname, search = '') {
  const storage = new Map(), history = []
  globalThis.sessionStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }
  globalThis.window = { location: { pathname, search }, history: { replaceState: (_state, _title, path) => history.push(path) } }
  return { storage, history }
}
for (const [environment, module, base] of [['edgeone', edgeone, ''], ['pages', pages, '/qwerty-learner']]) {
  test(environment + ' restores only the original safe route after guarded home admission', () => {
    for (const target of ['/typing', '/learn', '/mobile/data']) {
      const f = fixture(base + target)
      module.rememberAccountEntry(target.startsWith('/mobile'))
      globalThis.window.location.pathname = base + (target.startsWith('/mobile') ? '/mobile/account' : '/')
      globalThis.window.location.search = target.startsWith('/mobile') ? '' : '?s1-account=manage'
      module.beginAccountReturn(target.startsWith('/mobile'), 'preparing')
      module.finishAccountReturn()
      assert.deepEqual(f.history, [], 'account document must not navigate around its boot')
      globalThis.window.location.pathname = base + (target.startsWith('/mobile') ? '/mobile' : '/')
      globalThis.window.location.search = ''
      assert.equal(module.accountProgressContext().preparing, true)
      module.finishAccountReturn()
      assert.deepEqual(f.history, [base + target])
      module.finishAccountReturn()
      assert.equal(f.history.length, 1, 'return context is one-use')
    }
  })
}
test('cancelled visits restore the UI route without becoming an authentication handoff', () => {
  const f = fixture('/typing')
  edgeone.rememberAccountEntry(false)
  edgeone.beginAccountReturn(false, 'returning')
  globalThis.window.location.pathname = '/'
  assert.deepEqual(edgeone.accountProgressContext(), { mobile: false, preparing: false, returning: true })
  edgeone.finishAccountReturn()
  assert.deepEqual(f.history, ['/typing'])
})
test('forged, stale and operational return destinations cannot redirect the page', () => {
  for (const target of ['https://other.example', '//other.example', '/?s1-clear=manage', '/?s2-sync=run', '/mobile/account', '/admin', '/unknown']) {
    const f = fixture('/')
    f.storage.set('qwerty.account-journey.v1', JSON.stringify({ version: 1, target, mobile: false, phase: 'preparing', createdAt: Date.now() }))
    edgeone.finishAccountReturn()
    assert.deepEqual(f.history, [])
  }
  const f = fixture('/typing')
  edgeone.rememberAccountEntry(false)
  const value = JSON.parse(f.storage.get('qwerty.account-journey.v1'))
  f.storage.set('qwerty.account-journey.v1', JSON.stringify({ ...value, phase: 'preparing', createdAt: Date.now() - 31 * 60_000 }))
  globalThis.window.location.pathname = '/'
  edgeone.finishAccountReturn()
  assert.deepEqual(f.history, [])
})
test('unavailable navigation storage leaves existing home admission as the fallback', () => {
  fixture('/typing')
  globalThis.sessionStorage = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } }
  edgeone.rememberAccountEntry(false)
  edgeone.beginAccountReturn(false, 'preparing')
  assert.equal(edgeone.accountProgressContext(), null)
  edgeone.finishAccountReturn()
})
