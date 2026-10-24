import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-utf8-'))
const out = join(dir, 'import-blob.mjs')
await build({ entryPoints: [resolve(root, 'src/utils/db/dexie-import-blob.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20' })
after(() => {
  assert.equal(dirname(resolve(dir)), resolve(tmpdir()))
  assert.ok(basename(dir).startsWith('qwerty-utf8-'))
  rmSync(dir, { recursive: true, force: true })
})
const { createDexieImportBlob } = await import(pathToFileURL(out).href)

test('local import JSON preserves every UTF-16 code unit and escaped keys', async () => {
  const units = Array.from({ length: 65536 }, (_, i) => String.fromCharCode(i))
  const data = { '键🙂': units, paired: '中文🙂é', escapes: '\\u4e2d\n\t"' }
  const json = JSON.stringify(data)
  const blob = createDexieImportBlob(json)
  const encoded = await blob.text()
  assert.ok([...new Uint8Array(await blob.arrayBuffer())].every(byte => byte < 128))
  assert.deepEqual(JSON.parse(encoded), data)
  assert.equal(JSON.stringify(data), json, 'original archive content must not change')
})

test('import adaptation preserves Typeson metadata and actual replacement characters literally', async () => {
  const data = { text: '�', words: [{ trans: ['释义'], at: 0 }, '#words.0'],
    $types: { 'words.0.at': 'date', 'words.1': '#' } }
  const encoded = await createDexieImportBlob(JSON.stringify(data)).text()
  assert.deepEqual(JSON.parse(encoded), data)
  assert.equal(JSON.parse(encoded).text.charCodeAt(0), 0xfffd)
})
