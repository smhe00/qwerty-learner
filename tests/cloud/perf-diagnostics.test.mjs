/* eslint-env node */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-perf-report-'))
const out = join(tmp, 'perf.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/perf-diagnostics.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20' })
after(() => rmSync(tmp, { recursive: true, force: true }))
const {
  clearPerfSamples, readPerfSamples, recordPerfSize,
  startPerfStage, timePerfStage, recordV4TransportSample,
} = await import(pathToFileURL(out).href)

function storage() {
  const map = new Map()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
  }
}

test('privacy-safe diagnostics only retain stage, flow, durations and byte counts', async () => {
  globalThis.sessionStorage = storage()
  clearPerfSamples()
  const stop = startPerfStage('startup', 'guarded-bootstrap')
  stop()
  stop() // Idempotent
  recordPerfSize('sync', 'payload-raw', 121234)
  await timePerfStage('sync', 'remote-meta', async () => undefined)
  const samples = readPerfSamples()
  assert.equal(samples.length, 3)
  assert.equal(samples[0].stage, 'guarded-bootstrap')
  assert.equal(samples[1].sizeBytes, 121234)
  assert.equal(samples[2].stage, 'remote-meta')
  assert.deepEqual(Object.keys(samples[0]).sort(), ['at', 'elapsedMs', 'flow', 'stage'])
  assert.deepEqual(Object.keys(samples[1]).sort(), ['at', 'flow', 'sizeBytes', 'stage'])
  assert.equal(JSON.stringify(samples).includes('token'), false)
})

test('bounded and fail-open when sessionStorage unavailable or full', () => {
  globalThis.sessionStorage = storage()
  for (let i = 0; i < 800; i++) recordPerfSize('sync', 'payload-gzip', i)
  assert.equal(readPerfSamples().length, 768)
  assert.equal(readPerfSamples().at(-1).sizeBytes, 799)
  globalThis.sessionStorage = {
    getItem() { throw Error('storage unavailable') },
    setItem() { throw Error('storage full') },
    removeItem() { throw Error('denied') },
  }
  assert.doesNotThrow(() => recordPerfSize('sync', 'payload-gzip', 4))
  assert.deepEqual(readPerfSamples(), [])
  assert.doesNotThrow(clearPerfSamples)
})

test('V4 transport samples preserve fixed phase and attempt, strip secrets', () => {
  globalThis.sessionStorage = storage()
  recordV4TransportSample({
    stage: 'v4-part', partIndex: 7, attempt: 2, outcome: 'failed',
    elapsedMs: 145.3, sizeBytes: 32768,
    failureStage: 'blob_readback', failureCategory: 'blob_storage',
    httpStatus: 503, blobWriteMs: 82, blobReadbackMs: 23,
    token: 'secret-test-token', url: 'https://private.invalid',
  })
  recordV4TransportSample({
    stage: 'v4-commit', elapsedMs: 2300, outcome: 'ok',
    partsReadMs: 400, commitCoreMs: 1600, cleanupMs: 200,
  })
  const rows = readPerfSamples()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].partIndex, 7)
  assert.equal(rows[0].attempt, 2)
  assert.equal(rows[0].failureCategory, 'blob_storage')
  assert.equal(rows[0].blobWriteMs, 82)
  assert.equal(rows[1].stage, 'v4-commit')
  assert.equal(rows[1].commitCoreMs, 1600)
  assert.equal(JSON.stringify(rows).includes('secret-test-token'), false)
  assert.equal(JSON.stringify(rows).includes('private.invalid'), false)
})
