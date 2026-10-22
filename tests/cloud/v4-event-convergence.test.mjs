import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-v4-convergence-'))
const out = join(tmp, 'project.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v4-event-convergence.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { projectUuidLearningConvergence: project } = await import(pathToFileURL(out).href)

const t0 = 1_800_000_000
const uuids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
]
const row = (attemptId, timeStamp, options = {}) => ({
  id: 1, attemptId, timeStamp, dict: 'school', word: 'alpha',
  chapter: -1, timing: [], wrongCount: 0, mistakes: {},
  sourceMode: 'learn', learnItemKind: 'review',
  reviewRatingDecision: { eligible: true, rating: 'good', confidence: 1,
    reasonCodes: ['m2-test'] }, ...options,
})
const admission = () => row(uuids[0], t0, {
  learnItemKind: 'acquisition', reviewRatingDecision: undefined,
})

test('M2 event projection is commutative/idempotent and FSRS replay is stable', () => {
  const a = admission()
  const b = row(uuids[1], t0 + 86_400)
  // Every distinct attempt is a study fact, regardless of spacing.
  const c = row(uuids[2], t0 + 86_461, {
    reviewRatingDecision: { eligible: true, rating: 'hard', confidence: 1,
      reasonCodes: ['m2-test'] },
  })
  // All three local numeric IDs collide; attempts remain distinct by UUID.
  const left = project({ local: [a, b], remote: [a, c] })
  const right = project({ local: [c, a], remote: [b, a] })
  const replayed = project({ local: [a, b, c], remote: [a, b, c] })
  assert.equal(left.status, 'projected')
  assert.equal(left.publishReady, false)
  assert.equal(left.uniqueAttempts, 3)
  assert.equal(left.sharedAttempts, 1)
  assert.deepEqual(left.words, right.words)
  assert.deepEqual(left.words, replayed.words)
  assert.deepEqual(left.words[0].attemptIds, uuids.slice(0, 3))
  assert.equal(left.words[0].fsrsState.reviewCount, 2)
  assert.equal(left.words[0].fsrsState.schedulerState.kind, 'fsrs6')
  // Caller-owned primary IDs and objects are never rewritten.
  assert.equal(b.id, 1)
  assert.equal(c.id, 1)
})

test('same UUID with contradictory evidence is not silently collapsed', () => {
  const a = row(uuids[1], t0, { wrongCount: 1 })
  const b = row(uuids[1], t0, { wrongCount: 2 })
  assert.equal(project({ local: [a], remote: [b] }).reason, 'identity-conflict')
})

test('legacy unanchored or malformed attempts block, rather than lose a record', () => {
  const legacy = row(undefined, t0)
  assert.equal(project({ local: [legacy], remote: [] }).reason, 'legacy-unverified')
  assert.equal(project({ local: [row('bad', t0)], remote: [] }).reason, 'identity-conflict')
  const malformed = row(uuids[1], Number.NaN)
  assert.equal(project({ local: [malformed], remote: [] }).reason, 'invalid-event')
})

test('identical spelling in different dictionaries gives distinct FSRS states', () => {
  const a = row(uuids[1], t0, { dict: 'book-A', word: 'same',
    learnItemKind: 'acquisition', reviewRatingDecision: undefined })
  const b = row(uuids[2], t0, { dict: 'book-B', word: 'same',
    learnItemKind: 'acquisition', reviewRatingDecision: undefined })
  const x = project({ local: [b], remote: [a] })
  assert.equal(x.status, 'projected')
  assert.equal(x.words.length, 2)
  assert.deepEqual(x.words.map(w => w.dict), ['book-A', 'book-B'])
  assert.deepEqual(x.words.map(w => w.fsrsState.reviewCount), [0, 0])
})


test('two devices both Good inside 60s remain two legitimate FSRS reviews', () => {
  const first = row(uuids[1], t0 + 86_400)
  const second = row(uuids[2], t0 + 86_421)
  const x = project({ local: [admission(), first], remote: [second] })
  assert.equal(x.status, 'projected')
  assert.equal(x.uniqueAttempts, 3)
  assert.equal(x.words[0].fsrsState.reviewCount, 2)
  const inverse = project({ local: [second], remote: [first, admission()] })
  assert.deepEqual(x.words, inverse.words)
})
test('Good and Again at identical timestamp both count; attemptId resolves tie deterministically', () => {
  const first = row(uuids[1], t0 + 86_400)
  const second = row(uuids[2], t0 + 86_400, {
    reviewRatingDecision: { eligible: true, rating: 'again',
      confidence: 1, reasonCodes: ['m2-test'] },
  })
  const x = project({ local: [admission(), second], remote: [first] })
  const y = project({ local: [first], remote: [second, admission()] })
  assert.equal(x.status, 'projected')
  assert.equal(x.words[0].fsrsState.reviewCount, 2)
  assert.equal(x.words[0].fsrsState.lastOutcome, 'again')
  assert.deepEqual(x.words, y.words)
  assert.deepEqual(x.words[0].attemptIds, uuids.slice(0,3))
})
test('two ratings from an identical prior base digest still remain two real reviews', () => {
  const digest = 'c'.repeat(64)
  const a = row(uuids[1], t0 + 86_400, { reviewBaseStateFingerprint: digest })
  const b = row(uuids[2], t0 + 86_800, { reviewBaseStateFingerprint: digest })
  const r = project({ local: [admission(), a], remote: [b] })
  assert.equal(r.status, 'projected')
  assert.equal(r.words[0].fsrsState.reviewCount, 2)
})
test('retransmitting the identical attemptId only counts one review', () => {
  const a = admission()
  const b = row(uuids[1], t0 + 86_400)
  const r = project({ local: [a,b], remote: [b,a] })
  assert.equal(r.status, 'projected')
  assert.equal(r.uniqueAttempts, 2)
  assert.equal(r.words[0].fsrsState.reviewCount, 1)
})
test('independent training remains evidence without advancing FSRS', () => {
  const a = admission()
  const b = row(uuids[1], t0 + 86_400)
  const training = row(uuids[2], t0 + 86_400, {
    reviewRatingDecision: { eligible: false, rating: null,
      reasonCodes: ['assisted'] },
  })
  const r = project({ local: [a,b], remote: [training] })
  assert.equal(r.status, 'projected')
  assert.equal(r.words[0].fsrsState.reviewCount, 1)
})
