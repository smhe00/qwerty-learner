import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-v4-word-scope-'))
const outfile = join(dir, 'scope.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v4-word-scoped-convergence.ts')],
  outfile, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(dir, { recursive: true, force: true }))
const { projectWordScopedConvergence: project } =
  await import(pathToFileURL(outfile).href)
const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006',
]
const t0 = 1_800_000_000
const row = (attemptId, word = 'apple', timeStamp = t0, more = {}) => ({
  id: 1, attemptId, word, dict: 'school', timeStamp, chapter: -1,
  timing: [], wrongCount: 0, mistakes: {}, sourceMode: 'learn',
  learnItemKind: 'review', reviewRatingDecision: {
    eligible: true, rating: 'good', confidence: 1,
    reasonCodes: ['test'] },
  ...more,
})
const acquisition = (uuid, word) => row(uuid, word, t0 - 86_400, {
  chapter: 0, learnItemKind: 'acquisition', reviewRatingDecision: undefined })
const grade = (uuid, value, fingerprint, word = 'apple', timestamp = t0) =>
  row(uuid, word, timestamp, {
    ...(fingerprint ? { reviewBaseStateFingerprint: fingerprint } : {}),
    reviewRatingDecision: { eligible: true, rating: value,
      confidence: 1, reasonCodes: ['test'] },
  })
const getWord = (projection, word) => projection.words.find(w => w.word === word)


test('same word Good then Again from two machines always replays BOTH', () => {
  const sha = 'a'.repeat(64)
  const a = acquisition(ids[0], 'apple')
  const g = grade(ids[1], 'good', sha)
  const f = grade(ids[2], 'again', sha, 'apple', t0 + 8)
  const first = project({ local: [a,g], remote: [a,f] })
  const next = project({ local: [f,a], remote: [g,a] })
  assert.equal(first.status, 'projected')
  assert.equal(first.stats.suppressedDuplicateGrades, 0)
  assert.deepEqual(first.words[0].attemptIds, ids.slice(0,3))
  assert.deepEqual(first.words[0].suppressedRatingAttemptIds, [])
  assert.equal(first.words[0].fsrsState.reviewCount, 2)
  assert.equal(first.words[0].fsrsState.lastOutcome, 'again')
  assert.deepEqual(first.words, next.words)
})
test('same-timestamp events are deterministically ordered by attemptId, not local Dexie ID', () => {
  const a = acquisition(ids[0], 'apple')
  const g = grade(ids[1], 'good', undefined)
  const f = grade(ids[2], 'again', undefined)
  const r = project({ local: [a,f], remote: [g] })
  assert.equal(r.status, 'projected')
  assert.equal(r.words[0].fsrsState.reviewCount, 2)
  assert.equal(r.words[0].fsrsState.lastOutcome, 'again')
})
test('same state digest even 400s apart never suppresses independent study', () => {
  const sha = 'b'.repeat(64)
  const r = project({
    local: [acquisition(ids[0], 'apple'), grade(ids[1], 'hard', sha)],
    remote: [grade(ids[2], 'easy', sha, 'apple', t0 + 400)],
  })
  assert.equal(r.status, 'projected')
  assert.equal(r.words[0].fsrsState.reviewCount, 2)
  assert.equal(r.words[0].fsrsState.lastOutcome, 'easy')
  assert.equal(r.stats.suppressedDuplicateGrades, 0)
})
test('one corrupt/legacy word stays quarantined while other words replay', () => {
  const r = project({
    local: [row(undefined, 'legacy'), acquisition(ids[0], 'banana')],
    remote: [grade(ids[1], 'good', undefined, 'banana', t0)],
  })
  assert.equal(r.status, 'partial')
  assert.equal(getWord(r, 'legacy').reason, 'legacy-or-unknown-attempt')
  assert.equal(getWord(r, 'banana').status, 'projected')
})
test('identical UUID retransmissions de-duplicate but preserve different UUIDs', () => {
  const a = acquisition(ids[0], 'apple')
  const b = grade(ids[1], 'good', undefined)
  const r = project({ local: [a,b], remote: [a,b] })
  assert.equal(r.status, 'projected')
  assert.equal(r.stats.uniqueAttempts, 2)
  assert.equal(r.words[0].fsrsState.reviewCount, 1)
})
test('contradictory same attempt UUID across dictionary blocks entire evidence', () => {
  const r = project({ local: [row(ids[1], 'apple')],
    remote: [row(ids[1], 'banana')] })
  assert.equal(r.status, 'blocked')
  assert.equal(r.reason, 'global-uuid-identity-conflict')
})
