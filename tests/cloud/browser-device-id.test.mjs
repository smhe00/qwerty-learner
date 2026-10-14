import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-device-id-'))
const out = join(tmp, 'device-id.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/device-id.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { browserDeviceId } = await import(pathToFileURL(out).href)

function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) }
}

test('device ID is persistent within a browser profile and different across profiles', () => {
  const original = globalThis.localStorage
  try {
    globalThis.localStorage = storage()
    const a = browserDeviceId()
    assert.match(a, /^qwerty-web-[0-9a-f-]{36}$/)
    assert.equal(browserDeviceId(), a)
    const secondProfile = storage()
    globalThis.localStorage = secondProfile
    const b = browserDeviceId()
    assert.notEqual(a, b)
    assert.equal(browserDeviceId(), b)
    secondProfile.setItem('qwerty.deviceId.v1', 'qwerty-web-Mozilla/5.0')
    const repaired = browserDeviceId()
    assert.notEqual(repaired, b)
    assert.match(repaired, /^qwerty-web-[0-9a-f-]{36}$/)
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else globalThis.localStorage = original
  }
})
