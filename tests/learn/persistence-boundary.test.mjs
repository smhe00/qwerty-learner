import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import ts from 'typescript'

// Execute the production modules. Only the store-owned queue port is replaced;
// no source matching assertions and no duplicate implementation of the registry.
function load(relativePath, dependencies = {}) {
  const source = readFileSync(new URL('../../' + relativePath, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const module = { exports: {} }
  const nativeRequire = createRequire(import.meta.url)
  new Function('module', 'exports', 'require', output)(module, module.exports, (name) => dependencies[name] ?? nativeRequire(name))
  return module.exports
}

const { requireDurableWordRecordId } = load('src/learn/durable-word-record.ts')

test('only valid persisted local IDs cross the Learn completion boundary', () => {
  for (const id of [-1, 0, NaN, Infinity, -Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1, undefined, null, '42']) {
    assert.throws(() => requireDurableWordRecordId(id), /本词尚未推进/)
  }
  assert.equal(requireDurableWordRecordId(42), 42)
})

test('handled persistence failure creates no unhandled rejection and registry still drains', async () => {
  let flushes = 0
  const { trackLearnPersistence, flushLearnPersistence } = load('src/learn/persistence.ts', {
    '@/store/reviewInfoAtom': { flushReviewRecordWrites: async () => { flushes++ } },
  })
  const failure = new Error('raw transaction aborted')
  await assert.rejects(trackLearnPersistence(Promise.reject(failure)), (error) => error === failure)
  let release
  const write = new Promise((resolve) => { release = resolve })
  assert.equal(trackLearnPersistence(write), write)
  let drained = false
  const draining = flushLearnPersistence().then(() => { drained = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(drained, false)
  release()
  await draining
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(flushes >= 2)
  // node:test fails this test if a detached finally() promise rejects.
})

test('flush also waits for a derived write scheduled as an earlier write settles', async () => {
  const { trackLearnPersistence, flushLearnPersistence } = load('src/learn/persistence.ts', {
    '@/store/reviewInfoAtom': { flushReviewRecordWrites: async () => {} },
  })
  let releaseFirst, releaseSecond
  const first = new Promise((resolve) => { releaseFirst = resolve })
  const second = new Promise((resolve) => { releaseSecond = resolve })
  trackLearnPersistence(first)
  void first.then(() => trackLearnPersistence(second))
  let drained = false
  const draining = flushLearnPersistence().then(() => { drained = true })
  releaseFirst()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(drained, false)
  releaseSecond()
  await draining
})

function storageAdapter(add, dispatch, policy, finished = false) {
  return load('src/utils/db/index.ts', {
    './record': { WordRecord: class { constructor(word) { this.word = word } } },
    './attempt-identity': { newLearningAttemptId: () => 'test-stable-attempt-id' },
    './word-record-retention': { compactTypingWordRecord: (record) => record },
    './core': { db: { wordRecords: { add } } },
    '@/achievement/session': { getAchievementSessionId: () => 'test-session' },
    '@/dev/diagnostic-trace': { appendDeveloperTrace: () => {} },
    '@/sync/learning-sync-policy': { learningEventSyncEnabled: policy },
    '@/pages/Typing/store': { TypingContext: {}, TypingStateActionType: { ADD_WORD_RECORD_ID: 'add-id' } },
    '@/store': { currentChapterAtom: 0, currentDictIdAtom: 'cet4', isReviewModeAtom: false, reviewModeInfoAtom: { reviewRecord: { isFinished: finished, words: [] } } },
    jotai: { useAtomValue: (value) => value },
    react: { useCallback: (callback) => callback, useContext: () => ({ dispatch }) },
  }).useSaveWordRecord()
}

const input = { word: 'cancel', wrongCount: 0, letterTimeArray: [], letterMistake: {}, sourceMode: 'typing' }

test('a committed record stays successful when UI or publication policy throws', async () => {
  const rows = []
  const save = storageAdapter(
    async (row) => { rows.push(row); return 42 },
    () => { throw new Error('UI notification failed') },
    () => { throw new Error('publication policy unavailable') },
  )
  assert.equal(await save(input), 42)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].attemptId, 'test-stable-attempt-id')
})

test('aborted raw write does not notify or run publication policy', async () => {
  let effects = 0
  const save = storageAdapter(
    async () => { throw new Error('transaction aborted') },
    () => { effects++ },
    () => { effects++; return false },
  )
  assert.equal(await save(input), -1)
  assert.equal(effects, 0)
})

test('terminal Learn session remains immutable', async () => {
  let writes = 0
  const save = storageAdapter(async () => { writes++; return 42 }, () => {}, () => false, true)
  assert.equal(await save({ ...input, sourceMode: 'learn' }), -1)
  assert.equal(writes, 0)
})
