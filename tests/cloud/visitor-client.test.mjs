/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'

async function fixture({ pages = false, disabled = false, automated = false, fail = false, ready = false, cookie = '', blocked = false } = {}) {
  const built = await build({ entryPoints: ['src/metrics/visitor-count.ts'], bundle: true, write: false,
    format: 'iife', globalName: 'visitor', platform: 'browser', target: 'es2020',
    define: { REACT_APP_DEPLOY_ENV: JSON.stringify(pages ? 'pages' : 'edgeone'), 'import.meta.env.VITE_QWERTY_SYNC_DISABLED': JSON.stringify(disabled ? 'true' : 'false') },
  })
  const calls = [], tasks = [], events = new Map()
  const sandbox = {
    navigator: { webdriver: automated },
    document: { readyState: ready ? 'complete' : 'loading', get cookie() { return cookie }, set cookie(value) { if (!blocked) cookie = value.split(';')[0] } },
    crypto: webcrypto, location: { protocol: 'https:' },
    window: { addEventListener: (name, action) => events.set(name, action), requestIdleCallback: action => tasks.push(action) },
    fetch: (...args) => { calls.push(args); if (fail) throw Error('network failure'); return Promise.reject(Error('unavailable')) },
    get localStorage() { throw Error('analytics must not access localStorage') },
    get sessionStorage() { throw Error('analytics must not access sessionStorage') },
    get indexedDB() { throw Error('analytics must not access IndexedDB') },
  }
  runInNewContext(built.outputFiles[0].text, sandbox)
  return { schedule: sandbox.visitor.scheduleVisitorCount, calls, tasks, events, cookie: () => cookie }
}

test('report is after-load, after-idle, one-way and once per document, with no learning/auth state', async () => {
  const f = await fixture()
  f.schedule(); f.schedule()
  assert.equal(f.calls.length, 0)
  assert.equal(f.tasks.length, 0)
  f.events.get('load')()
  assert.equal(f.calls.length, 0)
  f.tasks[0]()
  await Promise.resolve()
  assert.equal(f.calls.length, 1)
  const [url, options] = f.calls[0]
  assert.equal(url, '/api/visits')
  assert.equal(options.method, 'POST')
  assert.equal(options.credentials, 'same-origin')
  assert.equal(options.keepalive, true)
  assert.equal(options.referrerPolicy, 'no-referrer')
  assert.equal(options.body, undefined)
  assert.equal(options.headers, undefined)
  assert.match(f.cookie(), /^qp_uv=[a-f0-9]{32}$/)
  f.schedule()
  assert.equal(f.calls.length, 1)
  const reloaded = await fixture({ ready: true, cookie: f.cookie() })
  reloaded.schedule(); reloaded.tasks[0]()
  await Promise.resolve()
  assert.equal(reloaded.cookie(), f.cookie())
})

test('Pages/cloud-disabled/automated sessions emit nothing; synchronous failures are swallowed', async () => {
  for (const flags of [{ pages: true }, { disabled: true }, { automated: true }]) {
    const f = await fixture({ ...flags, ready: true })
    f.schedule()
    assert.equal(f.calls.length, 0)
    assert.equal(f.tasks.length, 0)
  }
  const f = await fixture({ ready: true, fail: true })
  assert.doesNotThrow(f.schedule)
  assert.doesNotThrow(f.tasks[0])
  const blocked = await fixture({ ready: true, blocked: true })
  blocked.schedule(); blocked.tasks[0]()
  assert.equal(blocked.calls.length, 0)
})
