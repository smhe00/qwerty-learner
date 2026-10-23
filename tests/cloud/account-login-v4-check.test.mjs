import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-login-v4-'))
after(() => rmSync(tmp, { recursive: true, force: true }))
async function compile(flag) {
  const output = join(tmp, flag + '.mjs')
  await build({
    entryPoints: [resolve(root, 'src/sync/account-login-v4-check.ts')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    define: {
      REACT_APP_DEPLOY_ENV: '"edgeone"',
      'import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC': JSON.stringify(flag),
      'import.meta.env.VITE_QWERTY_SYNC_DISABLED': '"false"',
    },
    plugins: [
      {
        name: 'isolated-ports',
        setup(b) {
          b.onResolve({ filter: /workspace-vault|v2-browser-executor/ }, (x) => ({ path: x.path, namespace: 'mock' }))
          b.onLoad({ filter: /.*/, namespace: 'mock' }, (x) => ({
            contents: x.path.includes('workspace-vault')
              ? 'export const workspaceRegistryPort={read:()=>globalThis.__login.read()}'
              : 'export const executePreMountManualSyncV2=(boot)=>globalThis.__login.execute(boot)',
          }))
        },
      },
    ],
  })
  return (await import(pathToFileURL(output).href)).checkAccountV4AfterAuthentication
}
const enabled = await compile('true'),
  disabled = await compile('false')
const routeOutput = join(tmp, 'startup.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/account-startup-v4.ts')],
  outfile: routeOutput,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
})
const { shouldCheckAccountV4AtStartup: startup } = await import(pathToFileURL(routeOutput).href)

const registry = { generation: 1, pending: null, active: { kind: 'account', accountId: 'synthetic-owner' } }
function fixture(outcome = { status: 'noop', revision: 0 }) {
  globalThis.window = { location: { origin: 'https://q.smhe.cn' } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
  const calls = []
  globalThis.__login = {
    read: async () => {
      calls.push('registry')
      return registry
    },
    execute: async (boot) => {
      calls.push('s2')
      assert.deepEqual(boot, { mode: 'isolated', registry })
      return outcome
    },
  }
  return calls
}

test('login: disabled S2 performs no registry/DB/network work even on an approved origin', async () => {
  const calls = fixture()
  const result = await disabled()
  assert.equal(result.status, 'pending')
  assert.deepEqual(calls, [])
})
test('login: unapproved origin and offline never execute S2', async () => {
  const calls = fixture()
  globalThis.window.location.origin = 'https://preview.edgeone.dev'
  assert.match((await enabled()).detail, /未启用/)
  globalThis.window.location.origin = 'https://t.smhe.cn'
  globalThis.navigator.onLine = false
  assert.match((await enabled()).detail, /检查尚未执行/)
  assert.deepEqual(calls, [])
})
test('login: pending account transition prevents S2 and M3 continuation', async () => {
  const calls = fixture()
  globalThis.__login.read = async () => ({ ...registry, pending: {} })
  const result = await enabled()
  assert.equal(result.canContinue, false)
  assert.equal(result.status, 'pending')
  assert.deepEqual(calls, [])
})
for (const status of ['noop', 'pushed', 'pull-reload-required', 'conflict', 'blocked']) {
  test('login: guarded S2 ' + status + ' is accurately surfaced', async () => {
    const calls = fixture({ status, revision: 1, reason: 'unbound-local' })
    const result = await enabled()
    assert.deepEqual(calls, ['registry', 's2'])
    if (status === 'pull-reload-required') {
      assert.equal(result.status, 'pull-staged')
      assert.equal(result.canContinue, false)
      assert.match(result.detail, /持久化恢复事务/)
    } else if (status === 'conflict' || status === 'blocked') {
      assert.equal(result.status, 'pending')
      assert.match(result.detail, /尚未完成完整融合/)
    } else assert.equal(result.status, status)
  })
}
for (const error of [
  'Backup V4 independent roundtrip value mismatch: reviewRecords',
  'network timeout after uncertain commit',
  'session_revoked private-identity',
]) {
  test('login: failed audit/transport remains pending without retry or private errors', async () => {
    const calls = fixture()
    globalThis.__login.execute = async () => {
      calls.push('s2')
      throw new Error(error)
    }
    const result = await enabled()
    assert.equal(result.status, 'pending')
    assert.deepEqual(calls, ['registry', 's2'])
    assert.ok(!result.detail.includes('private-identity'))
    assert.match(result.detail, /未通过|尚未完成完整融合/)
  })
}

test('startup: ordinary signed-in learning entry checks full V4; account/tools/offline never do', () => {
  const input = { pathname: '/learn', search: '', account: true, liveAuth: true, enabled: true, online: true }
  assert.equal(startup(input), true)
  for (const pathname of ['/mobile', '/mobile/study', '/']) assert.equal(startup({ ...input, pathname }), true)
  for (const pathname of ['/mobile/account', '/analysis']) assert.equal(startup({ ...input, pathname }), false)
  for (const search of ['?s1-account=manage', '?s2-sync=run', '?m4-reconcile=1']) assert.equal(startup({ ...input, search }), false)
  for (const key of ['account', 'liveAuth', 'enabled', 'online']) assert.equal(startup({ ...input, [key]: false }), false)
})
