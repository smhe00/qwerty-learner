import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-session-identity-'))
const compiled = join(dir, 'review-record.mjs')
const retention = join(dir, 'review-retention.mjs')
await build({ entryPoints: [resolve(root, 'src/utils/db/record.ts')],
  outfile: compiled, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json') })
await build({ entryPoints: [resolve(root, 'src/utils/db/review-record-retention.ts')],
  outfile: retention, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(dir, { recursive: true, force: true }))
const { ReviewRecord } = await import(pathToFileURL(compiled).href)
const { compactFinishedReviewRecord } = await import(pathToFileURL(retention).href)

test('new Review session receives a persistent UUID independent of numeric DB key', () => {
  const left = new ReviewRecord('school', [])
  const right = new ReviewRecord('school', [])
  assert.match(left.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  assert.notEqual(left.sessionId, right.sessionId)
  left.id = right.id = 1
  assert.notEqual(left.sessionId, right.sessionId)
  const saved = JSON.parse(JSON.stringify(left))
  assert.equal(saved.sessionId, left.sessionId)
})

test('completion compaction preserves UUID through serialized/reloaded V4 record', () => {
  const session = new ReviewRecord('school', [])
  session.id = 23
  session.index = 1
  session.isFinished = true
  const compact = compactFinishedReviewRecord(session)
  const saved = JSON.parse(JSON.stringify(compact))
  assert.equal(saved.sessionId, session.sessionId)
  assert.equal(saved.id, 23)
  assert.equal(saved.index, 1)
  assert.deepEqual(saved.words, [])
  assert.equal(compactFinishedReviewRecord(saved).sessionId, saved.sessionId)
  const legacy = { ...session }
  delete legacy.sessionId
  assert.equal(Object.hasOwn(compactFinishedReviewRecord(legacy), 'sessionId'), false)
})
