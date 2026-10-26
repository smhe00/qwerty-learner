import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createModuleLoader } from './load-module.mjs'

const load = createModuleLoader()
const { commitWordRecord } = load('src/learn/word-record-commit.ts')
const { assertLearnCompletion } = load('src/learn/word-completion.ts')
const input = { word: 'cancel', sourceMode: 'learn', learnItemKind: 'review', wrongCount: 0, letterTimeArray: [], letterMistake: {} }
const context = { dict: 'cet4', chapter: -1, sessionFinished: false }
const row = { word: 'cancel', dict: 'cet4', chapter: -1, sourceMode: 'learn', attemptId: 'immutable-attempt', timeStamp: 1, wrongCount: 0, timing: [], mistakes: {} }
const ports = (overrides = {}) => ({ prepare: () => structuredClone(row), add: async () => 42, effects: [], reportEffectError: () => {}, ...overrides })

test('terminal Learn session rejects before construction, storage or effects', async () => {
  const fail = () => assert.fail('must not run')
  assert.deepEqual(await commitWordRecord(input, { ...context, sessionFinished: true }, ports({ prepare: fail, add: fail, effects: [{ name: 'x', run: fail }] })), { status: 'rejected', reason: 'session-finished' })
})

test('prepare and raw storage failures stay distinct; neither executes post-commit effects', async () => {
  for (const stage of ['prepare', 'write']) {
    const error = new Error(stage)
    let writes = 0
    const result = await commitWordRecord(input, context, ports({
      prepare: () => { if (stage === 'prepare') throw error; return row },
      add: async () => { writes++; throw error },
      effects: [{ name: 'forbidden', run: () => assert.fail('not durable') }],
    }))
    assert.deepEqual(result, { status: 'failed', stage, error })
    assert.equal(writes, stage === 'write' ? 1 : 0)
  }
})

test('invalid adapter IDs cannot produce a success receipt', async () => {
  for (const id of [-1, 0, NaN, Infinity, 1.5]) {
    const result = await commitWordRecord(input, context, ports({ add: async () => id, effects: [{ name: 'forbidden', run: () => assert.fail('invalid id') }] }))
    assert.equal(result.status, 'failed')
    assert.equal(result.stage, 'write')
  }
})

test('receipt is issued only after storage resolves and effects are registered before success is returned', async () => {
  let release
  const order = []
  const resultPromise = commitWordRecord(input, context, ports({
    add: () => new Promise((resolve) => { release = resolve }),
    effects: [{ name: 'derived', run: (receipt) => { order.push(receipt.id) } }],
  }))
  await Promise.resolve()
  assert.deepEqual(order, [])
  release(42)
  const result = await resultPromise
  assert.equal(result.status, 'saved')
  assert.deepEqual(order, [42])
  assert.equal(result.receipt.record.attemptId, row.attemptId)
  assert.equal(result.receipt.record.id, 42)
  assert.ok(Object.isFrozen(result.receipt))
  assert.deepEqual(await result.effects, [{ effect: 'derived', status: 'fulfilled' }])
})

test('sync, async and reporting failures cannot undo success or suppress another effect', async () => {
  let writes = 0, ran = 0, release
  const result = await commitWordRecord(input, context, ports({
    add: async () => { writes++; return 42 },
    effects: [
      { name: 'ui', run: () => { throw new Error('notification') } },
      { name: 'projection', run: async () => { throw new Error('projection') } },
      { name: 'slow', run: () => new Promise((resolve) => { ran++; release = resolve }) },
    ],
    reportEffectError: () => { throw new Error('logger unavailable') },
  }))
  assert.equal(result.status, 'saved')
  assert.equal(writes, 1)
  assert.equal(ran, 1)
  release()
  assert.deepEqual((await result.effects).map(({ status }) => status), ['rejected', 'rejected', 'fulfilled'])
  assert.equal(writes, 1)
})

test('completion accepts its committed record and rejects missing or mismatched receipts', async () => {
  const saved = await commitWordRecord(input, context, ports())
  const result = { mode: 'learn', receipt: saved.receipt, record: saved.receipt.record }
  assert.doesNotThrow(() => assertLearnCompletion(result, 'cet4', 'cancel'))
  for (const bad of [{ ...result, mode: 'typing' }, { ...result, receipt: undefined }, { ...result, record: { ...result.record, attemptId: 'other' } }, { ...result, record: { ...result.record, id: 43 } }]) {
    assert.throws(() => assertLearnCompletion(bad, 'cet4', 'cancel'))
  }
  assert.throws(() => assertLearnCompletion(result, 'cet6', 'cancel'))
  assert.throws(() => assertLearnCompletion(result, 'cet4', 'another-word'))
})

test('concurrent independent calls do not share record or receipt identity', async () => {
  let id = 0
  const p = ports({ prepare: (value) => ({ ...row, word: value.word, attemptId: value.word }), add: async () => ++id })
  const results = await Promise.all(['cancel', 'analyse'].map((word) => commitWordRecord({ ...input, word }, context, p)))
  assert.deepEqual(results.map((r) => [r.receipt.id, r.receipt.word, r.receipt.attemptId]), [[1, 'cancel', 'cancel'], [2, 'analyse', 'analyse']])
})

test('record builder preserves timings, evidence, UUID, mode retention and fingerprint eligibility', () => {
  const { buildWordRecord } = createModuleLoader({
    './attempt-identity': { newLearningAttemptId: () => 'same-generator-id' },
    '@/sync/learning-clock': { learningClockEpochMs: () => 123456000 },
  })('src/utils/db/word-record-builder.ts')
  const evidence = { version: 1, marker: 'frozen self-report stays self-report' }
  const value = { ...input, letterTimeArray: [100, 120, 160], reviewEvidence: evidence, reviewRatingDecision: { eligible: true, rating: 'good' }, reviewBaseStateFingerprint: 'before-state', learningContext: { version: 1, revealedBeforeFirstKey: false } }
  const built = buildWordRecord(value, context)
  assert.deepEqual({ ...built }, {
    word: 'cancel', dict: 'cet4', chapter: -1, timeStamp: 123456, timing: [20, 40], wrongCount: 0, mistakes: {},
    learningContext: value.learningContext, reviewEvidence: evidence, reviewRatingDecision: value.reviewRatingDecision,
    sourceMode: 'learn', learnItemKind: 'review', reviewBaseStateFingerprint: 'before-state', attemptId: 'same-generator-id',
  })
  assert.deepEqual(built.timing, [20, 40])
  assert.deepEqual(built.reviewEvidence, evidence)
  assert.equal(built.reviewBaseStateFingerprint, 'before-state')
  assert.equal(built.attemptId, 'same-generator-id')
  assert.equal(built.chapter, -1)
  assert.equal(built.dict, 'cet4')
  assert.equal(built.timeStamp, 123456)
  const acquisition = buildWordRecord({ ...value, learnItemKind: 'acquisition' }, context)
  assert.equal(acquisition.reviewBaseStateFingerprint, undefined)
  const typing = buildWordRecord({ ...value, sourceMode: 'typing', learnItemKind: undefined, reviewRatingDecision: undefined }, { ...context, chapter: 4 })
  assert.equal(typing.chapter, 4)
  assert.equal(typing.learningContext, undefined)
  assert.equal(typing.reviewEvidence, undefined)
  assert.deepEqual(typing.timing, [20, 40])
  assert.deepEqual(value.reviewEvidence, evidence)
})
