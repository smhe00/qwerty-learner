import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createModuleLoader } from './load-module.mjs'

test('all consumers use one ordered snapshot queue and Learn flush waits for its final write', async () => {
  const seen = [], releases = []
  const load = createModuleLoader({ './review-record': { putWordReviewRecord: (record) => { seen.push(record); return new Promise((resolve) => releases.push(resolve)) } } })
  const writer = load('src/utils/db/review-record-writer.ts')
  const learning = load('src/learn/persistence.ts')
  const record = { id: 1, words: [{ name: 'cancel' }], index: 0, isFinished: false }
  const first = writer.queueReviewRecordWrite(record)
  record.words[0].name = 'mutated after enqueue'
  const last = writer.queueReviewRecordWrite({ ...record, index: 1, isFinished: true })
  let flushed = false
  const flush = learning.flushLearnPersistence().then(() => { flushed = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].words[0].name, 'cancel')
  assert.equal(flushed, false)
  releases[0]()
  await first
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(seen.length, 2)
  assert.equal(seen[1].isFinished, true)
  assert.equal(flushed, false)
  releases[1]()
  await last
  await flush
  assert.equal(flushed, true)
})

test('write/flush reject on failure; an explicit later checkpoint can continue the queue', async () => {
  const error = new Error('checkpoint write aborted')
  let fail = true
  const load = createModuleLoader({ './review-record': { putWordReviewRecord: async () => { if (fail) throw error } } })
  const writer = load('src/utils/db/review-record-writer.ts')
  const pending = writer.queueReviewRecordWrite({ index: 0 })
  await assert.rejects(pending, (reason) => reason === error)
  await assert.rejects(writer.flushReviewRecordWrites(), (reason) => reason === error)
  fail = false
  await writer.queueReviewRecordWrite({ index: 1, isFinished: true })
  await writer.flushReviewRecordWrites()
  await new Promise((resolve) => setImmediate(resolve))
})
