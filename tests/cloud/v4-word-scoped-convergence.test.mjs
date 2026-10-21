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

test('one concurrent word is quarantined; unrelated words still replay and remain visible', () => {
  const local = [acquisition(ids[0], 'apple'), grade(ids[1], 'good', null),
    acquisition(ids[3], 'banana')]
  const remote = [grade(ids[2], 'again', null, 'apple', t0 + 5)]
  const before = structuredClone({ local, remote })
  const p = project({ local, remote })
  assert.equal(p.status, 'partial')
  assert.equal(p.stats.projectedWords, 1)
  assert.equal(p.stats.quarantinedWords, 1)
  assert.equal(getWord(p, 'apple').reason, 'unverified-concurrent-fsrs-review')
  assert.equal(getWord(p, 'banana').status, 'projected')
  assert.equal(getWord(p, 'banana').fsrsState.reviewCount, 0)
  assert.equal(p.publishReady, false)
  assert.equal(p.convergenceComplete, false)
  assert.deepEqual({ local, remote }, before)
})

test('same proven base: Again wins, Good persists as raw evidence but is not double-counted by FSRS', () => {
  const fingerprint = 'a'.repeat(64)
  const first = acquisition(ids[0], 'apple')
  const good = grade(ids[1], 'good', fingerprint)
  const again = grade(ids[2], 'again', fingerprint, 'apple', t0 + 8)
  const p = project({ local: [first, good], remote: [first, again] })
  assert.equal(p.status, 'projected', p.reason)
  assert.equal(p.stats.suppressedDuplicateGrades, 1)
  assert.equal(p.stats.uniqueAttempts, 3)
  assert.deepEqual(p.words[0].attemptIds, ids.slice(0, 3))
  assert.deepEqual(p.words[0].suppressedRatingAttemptIds, [ids[1]])
  assert.equal(p.words[0].fsrsState.reviewCount, 1)
  assert.equal(p.words[0].fsrsState.lastOutcome, 'again')
  assert.equal(good.reviewRatingDecision.eligible, true)
  assert.equal(again.reviewRatingDecision.eligible, true)
  const reversed = project({ local: [again, first], remote: [good, first] })
  assert.deepEqual(reversed.words, p.words)
})

test('same actual base fingerprint catches offline duplicate separated by over 60s', () => {
  const sha = 'b'.repeat(64)
  const p = project({
    local: [acquisition(ids[0], 'apple'), grade(ids[1], 'hard', sha)],
    remote: [grade(ids[2], 'easy', sha, 'apple', t0 + 400)],
  })
  assert.equal(p.status, 'projected', p.reason)
  assert.deepEqual(p.words[0].suppressedRatingAttemptIds, [ids[2]])
  assert.equal(p.words[0].fsrsState.reviewCount, 1)
  assert.equal(p.words[0].fsrsState.lastOutcome, 'hard')
})

test('equal ratings use UUID tie-break, not device arrival order or timestamp', () => {
  const sha = 'c'.repeat(64)
  const a = grade(ids[1], 'good', sha, 'apple', t0 + 1)
  const b = grade(ids[2], 'good', sha, 'apple', t0)
  const r = project({ local: [acquisition(ids[0], 'apple'), b],
    remote: [a] })
  assert.equal(r.status, 'projected')
  assert.deepEqual(r.words[0].suppressedRatingAttemptIds, [ids[2]])
  assert.equal(r.words[0].fsrsState.reviewCount, 1)
})

test('two different fingerprints or unanchored Review within 60s stay quarantined', () => {
  const a = grade(ids[1], 'again', 'a'.repeat(64))
  const b = grade(ids[2], 'good', 'b'.repeat(64))
  for (const right of [b, grade(ids[2], 'good', undefined)]) {
    const r = project({ local: [acquisition(ids[0], 'apple'), a],
      remote: [right] })
    assert.equal(r.status, 'blocked')
    assert.equal(r.words[0].reason, 'unverified-concurrent-fsrs-review')
  }
})

test('third score on same base is not collapsed to an arbitrary winner', () => {
  const sha = 'e'.repeat(64)
  const r = project({ local: [acquisition(ids[0], 'apple'),
    grade(ids[1], 'good', sha), grade(ids[3], 'hard', sha)],
  remote: [grade(ids[2], 'again', sha)] })
  assert.equal(r.status, 'blocked')
  assert.equal(r.words[0].reason, 'unverified-concurrent-fsrs-review')
  assert.equal(r.stats.suppressedDuplicateGrades, 0)
})

test('older uuid-less word is quarantined without silencing another dictionary', () => {
  const r = project({ local: [row(undefined, 'legacy')],
    remote: [acquisition(ids[0], 'other', t0)] })
  assert.equal(r.status, 'partial')
  assert.equal(getWord(r, 'legacy').reason, 'legacy-or-unknown-attempt')
  assert.equal(getWord(r, 'other').status, 'projected')
})

test('contradictory reuse of same UUID globally blocks rather than merging wrong dictionary', () => {
  const r = project({ local: [row(ids[1], 'apple')],
    remote: [row(ids[1], 'banana')] })
  assert.equal(r.status, 'blocked')
  assert.equal(r.reason, 'global-uuid-identity-conflict')
  assert.deepEqual(r.words, [])
})

test('same-attempt UUID shared across devices remains exactly one FSRS rating', () => {
  const a = acquisition(ids[0], 'apple')
  const g = grade(ids[1], 'good', undefined)
  const r = project({ local: [a, g], remote: [a, g] })
  assert.equal(r.status, 'projected')
  assert.equal(r.words[0].fsrsState.reviewCount, 1)
  assert.equal(r.stats.uniqueAttempts, 2)
  assert.equal(r.stats.suppressedDuplicateGrades, 0)
})
