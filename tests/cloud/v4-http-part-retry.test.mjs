/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-v4-part-retry-'))
const target = join(tmp, 'retry.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v4-http-part-retry.ts')],
  outfile: target, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json') })
test.after(() => rmSync(tmp, { recursive: true, force: true }))
const { retryIdenticalV4Part, V4_PART_RETRY_DELAY_MS } =
  await import(pathToFileURL(target).href)

const retryable = error => error.code === 'v4_upload_body_read_failed' ||
  error.code === 'network_error'
const delay = []
const pause = async ms => delay.push(ms)

test('transient body-read 503 retries same immutable object then verifies receipt', async () => {
  const part = Object.freeze({ data: 'AQID', partSha256: 'f'.repeat(64), index: 1 })
  const seen = []
  let n = 0
  const reply = await retryIdenticalV4Part(async () => {
    seen.push(part)
    if (++n < 3) throw Object.assign(new Error('transient'), {
      code: 'v4_upload_body_read_failed' })
    return { received: true, index: part.index }
  }, retryable, pause)
  assert.equal(reply.index, 1)
  assert.equal(n, 3)
  assert.ok(seen.every(x => x === part))
  assert.deepEqual(delay.splice(0), [150, 350])
})
test('401, 403, 409 and invalid SHA fail immediately', async () => {
  for (const code of ['invalid_session', 'invalid_v4_upload_part',
    'v4_upload_part_sha_mismatch', 'sync_conflict']) {
    let count = 0
    await assert.rejects(retryIdenticalV4Part(async () => {
      count++
      throw Object.assign(new Error(code), { code })
    }, retryable, pause), error => error.code === code)
    assert.equal(count, 1)
  }
})
test('retry budget is finite and never loops indefinitely', async () => {
  let count = 0
  const sent = new Error('network unavailable')
  sent.code = 'network_error'
  await assert.rejects(retryIdenticalV4Part(async () => {
    count++
    throw sent
  }, retryable, pause), e => e === sent)
  assert.equal(count, V4_PART_RETRY_DELAY_MS.length)
  assert.deepEqual(delay.splice(0), [150, 350, 750, 1500, 3000])
})
test('successful first attempt does not pause or duplicate a part', async () => {
  let count = 0
  assert.equal(await retryIdenticalV4Part(async () => {
    count++
    return 10
  }, retryable, pause), 10)
  assert.equal(count, 1)
  assert.deepEqual(delay, [])
})
