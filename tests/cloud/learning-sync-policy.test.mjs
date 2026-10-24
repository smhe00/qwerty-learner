import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-learning-sync-policy-'))
after(() => rmSync(dir, { recursive: true, force: true }))
async function policy(name, deployEnv, disabled) {
  const bundle = join(dir, name + '.mjs')
  await build({
    entryPoints: [resolve(root, 'src/sync/learning-sync-policy.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    define: { REACT_APP_DEPLOY_ENV: JSON.stringify(deployEnv), 'import.meta.env.VITE_QWERTY_SYNC_DISABLED': JSON.stringify(disabled) },
  })
  return import(pathToFileURL(bundle).href)
}
const enabled = await policy('cloud', 'production', 'false')
const pages = await policy('pages', 'pages', 'false')
const disabled = await policy('disabled', 'production', 'true')

test('approved HTTPS origins share the event/adoption rollout policy', () => {
  for (const origin of ['https://t.smhe.cn', 'https://q.smhe.cn', 'https://qwerty-plus.edgeone.dev']) {
    assert.equal(enabled.isLearningSyncOrigin(origin), true)
    globalThis.window = { location: { origin } }
    assert.equal(enabled.learningEventSyncEnabled(), true)
  }
  delete globalThis.window
})

test('HTTP, preview, Pages, lookalike and alternate-port origins fail closed', () => {
  for (const origin of [
    'http://q.smhe.cn',
    'https://q.smhe.cn:8443',
    'https://q.smhe.cn.evil.org',
    'https://evil.org@q.smhe.cn',
    'https://preview.edgeone.dev',
    'https://smhe00.github.io',
    'http://127.0.0.1:4178',
    'null',
    '',
  ]) {
    globalThis.window = { location: { origin } }
    assert.equal(enabled.learningEventSyncEnabled(), false, origin)
  }
  delete globalThis.window
})

test('Pages builds and explicit cloud-disable remain off even on a trusted host', () => {
  globalThis.window = { location: { origin: 'https://q.smhe.cn' } }
  assert.equal(pages.learningEventSyncEnabled(), false)
  assert.equal(disabled.learningEventSyncEnabled(), false)
  delete globalThis.window
})

test('server-side imports do not start browser synchronization', () => {
  assert.equal(enabled.learningEventSyncEnabled(), false)
})

test('secure entry retains only the approved host and path, never query or credentials', () => {
  assert.equal(enabled.secureLearningEntry('http://q.smhe.cn/mobile/account?s1-reauth=1#private'), 'https://q.smhe.cn/mobile/account')
  assert.equal(enabled.secureLearningEntry('http://t.smhe.cn/learn'), 'https://t.smhe.cn/learn')
  for (const href of [
    'https://q.smhe.cn/mobile',
    'http://127.0.0.1:4193/mobile',
    'http://q.smhe.cn.evil.org/mobile',
    'http://user:pass@q.smhe.cn/mobile',
    'http://q.smhe.cn:8443/mobile',
    'not-a-url',
  ]) {
    assert.equal(enabled.secureLearningEntry(href), null)
  }
})

test('canonical HTTP authentication and synchronization never send a request', async () => {
  const file = join(dir, 'api.mjs')
  await build({
    entryPoints: [resolve(root, 'src/sync/api.ts')],
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    define: {
      REACT_APP_DEPLOY_ENV: '"production"',
      'import.meta.env.VITE_QWERTY_SYNC_DISABLED': '"false"',
      'import.meta.env.VITE_QWERTY_SYNC_BASE_URL': '""',
    },
  })
  const api = await import(pathToFileURL(file).href)
  let requests = 0
  const prior = globalThis.fetch
  globalThis.fetch = async () => {
    requests++
    throw Error('unexpected network')
  }
  globalThis.window = { location: { origin: 'http://q.smhe.cn', href: 'http://q.smhe.cn/mobile/account' } }
  try {
    for (const operation of [
      () => api.login('synthetic', 'synthetic'),
      () => api.getMe('synthetic-token'),
      () => api.getSyncV2Meta('synthetic-token'),
    ]) {
      await assert.rejects(operation, (e) => e.code === 'https_required')
    }
    assert.equal(requests, 0)
  } finally {
    globalThis.fetch = prior
    delete globalThis.window
  }
})
