import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-m4-monotonic-prefix-'))
const entry = join(dir, 'candidate.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/m4-witnessed-prefix-candidate.ts')],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfig: resolve(root, 'tsconfig.json'),
})
after(() => rmSync(dir, { recursive: true, force: true }))
const { previewMonotonicWitnessedM4: preview } = await import(pathToFileURL(entry).href)

const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const accountId = 'isolated-test-account'
const names = ['wordRecords', 'chapterRecords', 'reviewRecords', 'reviewWordStates', 'achievementEvents', 'achievementStates']
const evidence = (n, word = 'alpha', more = {}) => ({
  attemptId: uuid(n),
  dict: 'school',
  word,
  timeStamp: 1800000000 + n * 86400,
  chapter: -1,
  timing: [],
  wrongCount: 0,
  mistakes: {},
  sourceMode: 'learn',
  learnItemKind: 'review',
  reviewRatingDecision: { eligible: true, rating: 'good', confidence: 1, reasonCodes: ['test'] },
  ...more,
})
const admission = (n) =>
  evidence(n, 'alpha', {
    learnItemKind: 'acquisition',
    reviewRatingDecision: undefined,
  })
function snapshot(words, opts = {}) {
  return {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-23T00:00:00Z', source: { kind: 'account', accountId: opts.accountId || accountId } },
    workspaceData: {
      database: {
        formatName: 'dexie',
        formatVersion: 1,
        data: {
          databaseName: 'RecordDB',
          databaseVersion: 6,
          tables: names.map((name) => ({
            name,
            schema: '++id',
            rowCount:
              name === 'wordRecords' ? words.length : ['chapterRecords', 'reviewRecords', 'achievementEvents'].includes(name) ? 1 : 0,
          })),
          data: names.map((tableName) => ({
            tableName,
            inbound: true,
            rows:
              tableName === 'wordRecords'
                ? words.map((r, i) => ({ id: i + 1, ...r }))
                : tableName === 'chapterRecords'
                ? [{ id: 1, dict: 'school', chapter: 0, sentinel: 'unchanged' }]
                : tableName === 'reviewRecords'
                ? [{ id: 1, sessionId: uuid(90), cursor: 2 }]
                : tableName === 'achievementEvents'
                ? [{ id: 1, kind: 'opaque', legacy: true }]
                : [],
          })),
        },
      },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: { pronunciation: 'en' } },
      navigation: { currentDict: 'school', currentChapter: 0 },
    },
  }
}
const rows = (s, name) => s.workspaceData.database.data.data.find((x) => x.tableName === name).rows

test('monotonic M4 candidate retains six tables and adds independent UUID attempts with rekeyed IDs', async () => {
  const local = snapshot([admission(1)])
  const original = structuredClone(local)
  const remoteA = evidence(2)
  const remoteB = evidence(3)
  const result = await preview({ accountId, local, witnessedEvents: [remoteB, admission(1), remoteA] })
  assert.equal(result.status, 'candidate', result.reason)
  assert.equal(result.publishReady, false)
  assert.equal(result.convergenceComplete, false)
  assert.equal(result.newlyAdoptedAttempts, 2)
  assert.equal(result.witnessedAttempts, 3)
  assert.deepEqual(
    rows(result.candidate, 'wordRecords').map((x) => x.attemptId),
    [uuid(1), uuid(2), uuid(3)],
  )
  assert.deepEqual(
    rows(result.candidate, 'wordRecords').map((x) => x.id),
    [1, 2, 3],
  )
  const manifest = result.candidate.workspaceData.database.data.tables
  assert.equal(manifest.find((x) => x.name === 'wordRecords').rowCount, 3)
  assert.equal(manifest.find((x) => x.name === 'reviewWordStates').rowCount, 1)
  assert.equal(manifest.find((x) => x.name === 'reviewRecords').rowCount, 1)
  assert.equal(local.workspaceData.database.data.tables.find((x) => x.name === 'wordRecords').rowCount, 1)
  for (const table of ['reviewRecords', 'chapterRecords', 'achievementEvents', 'achievementStates']) {
    assert.deepEqual(rows(result.candidate, table), rows(local, table))
  }
  assert.deepEqual(result.candidate.workspaceData.learnRuntime, local.workspaceData.learnRuntime)
  assert.deepEqual(result.candidate.workspaceData.settings, local.workspaceData.settings)
  assert.deepEqual(result.candidate.workspaceData.navigation, local.workspaceData.navigation)
  assert.deepEqual(local, original, 'pure projection never mutates captured source')
  assert.equal(rows(result.candidate, 'reviewWordStates')[0].reviewCount, 2)
  assert.equal(rows(result.candidate, 'reviewWordStates')[0].schedulerState.kind, 'fsrs6')
})

test('repeated witnessed prefix is idempotent and cannot fabricate cloud convergence', async () => {
  const first = await preview({ accountId, local: snapshot([admission(1)]), witnessedEvents: [evidence(2)] })
  assert.equal(first.status, 'candidate')
  const second = await preview({ accountId, local: first.candidate, witnessedEvents: [evidence(2), evidence(2), admission(1)] })
  assert.deepEqual(second, {
    status: 'unchanged',
    reason: 'all-witnessed-attempts-already-local',
    publishReady: false,
    convergenceComplete: false,
  })
})

test('independent same-spelling review inside one minute is never deduplicated', async () => {
  const local = snapshot([admission(1), evidence(2)])
  const near = evidence(3, 'alpha', { timeStamp: evidence(2).timeStamp + 20 })
  const result = await preview({ accountId, local, witnessedEvents: [near] })
  assert.equal(result.status, 'candidate', result.reason)
  assert.equal(rows(result.candidate, 'reviewWordStates')[0].reviewCount, 2)
  assert.deepEqual(
    rows(result.candidate, 'wordRecords').map((x) => x.attemptId),
    [uuid(1), uuid(2), uuid(3)],
  )
})

test('contradictory immutable identity, invalid imported local ID and cross-owner block', async () => {
  const local = snapshot([admission(1)])
  const conflicting = evidence(1, 'different')
  for (const input of [
    { accountId: 'wrong-account', local, witnessedEvents: [evidence(2)] },
    { accountId, local, witnessedEvents: [conflicting] },
    { accountId, local, witnessedEvents: [evidence(2, 'alpha', { id: 99 })] },
    { accountId, local: snapshot([{ ...admission(1), attemptId: 'corrupt-present-id' }]), witnessedEvents: [evidence(2)] },
    { accountId, local: snapshot([admission(1), admission(1)]), witnessedEvents: [evidence(2)] },
  ]) {
    const result = await preview(input)
    assert.equal(result.status, 'blocked', JSON.stringify(result))
  }
})

test('untouched custom state is preserved, exclusion refuses replay', async () => {
  const local = snapshot([admission(1)])
  rows(local, 'reviewWordStates').push({
    id: 21,
    dict: 'school',
    word: 'untouched',
    schedulerState: { kind: 'fsrs6', stability: 10, difficulty: 5 },
    lifecycle: 'excluded',
    exclusion: { reason: 'manual' },
  })
  const result = await preview({ accountId, local, witnessedEvents: [evidence(7, 'unseen')] })
  assert.equal(result.status, 'candidate', result.reason)
  assert.deepEqual(rows(result.candidate, 'reviewWordStates')[0], rows(local, 'reviewWordStates')[0])
  const excluded = structuredClone(local)
  rows(excluded, 'reviewWordStates').push({
    id: 22,
    dict: 'school',
    word: 'unseen',
    lifecycle: 'excluded',
    exclusion: { reason: 'manual' },
  })
  assert.equal((await preview({ accountId, local: excluded, witnessedEvents: [evidence(7, 'unseen')] })).status, 'blocked')
})

test('Dexie Typeson transport markers cannot cause a false same-UUID conflict', async () => {
  const local = snapshot([admission(1)])
  const raw = structuredClone(rows(local, 'wordRecords'))
  rows(local, 'wordRecords')[0].$types = { '': 'userObject' }
  const witnessed = [admission(1), evidence(2)]
  const verified = await preview({ accountId, local, liveWordRecords: raw, witnessedEvents: witnessed })
  assert.equal(verified.status, 'candidate', verified.reason)
  assert.equal(verified.newlyAdoptedAttempts, 1)
  // A transport descriptor without independently audited live evidence is
  // never discarded on faith; unknown/forged markers still fail closed.
  const unverified = await preview({ accountId, local, witnessedEvents: witnessed })
  assert.equal(unverified.status, 'blocked')
  assert.equal(unverified.reason, 'm4-prefix-typeson-requires-live-source')
  const corrupt = structuredClone(local)
  rows(corrupt, 'wordRecords')[0].word = 'tampered'
  const mismatched = await preview({ accountId, local: corrupt, liveWordRecords: raw, witnessedEvents: witnessed })
  assert.equal(mismatched.status, 'blocked')
  assert.equal(mismatched.reason, 'm4-prefix-export-live-payload-mismatch')
  const contradiction = await preview({
    accountId,
    local,
    liveWordRecords: raw,
    witnessedEvents: [{ ...admission(1), word: 'different' }, evidence(2)],
  })
  assert.equal(contradiction.status, 'blocked')
  assert.equal(contradiction.reason, 'm4-prefix-conflicting-local-attempt')
})

// Mixed history is a normal migration state, not an identity or checksum waiver.
test('mixed legacy reviews contribute to replay while all original rows and other tables survive exactly', async () => {
  const legacy = evidence(1, 'alpha', { attemptId: undefined, sourceMode: undefined, reviewRatingDecision: undefined, wrongCount: 4 })
  const local = snapshot([legacy, evidence(2)])
  const original = structuredClone(local)
  const result = await preview({ accountId, local, witnessedEvents: [evidence(2), evidence(3)] })
  assert.equal(result.status, 'candidate', result.reason)
  assert.equal(result.newlyAdoptedAttempts, 1)
  assert.deepEqual(rows(result.candidate, 'wordRecords').slice(0, 2), rows(original, 'wordRecords'))
  assert.equal(rows(result.candidate, 'wordRecords')[0].attemptId, undefined)
  assert.equal(rows(result.candidate, 'wordRecords')[0].sourceMode, undefined)
  assert.equal(rows(result.candidate, 'reviewWordStates')[0].reviewCount, 3, 'legacy negative review must not disappear')
  assert.equal(result.retainedLegacyStates, 0)
  for (const name of ['chapterRecords', 'reviewRecords', 'achievementEvents', 'achievementStates'])
    assert.deepEqual(rows(result.candidate, name), rows(original, name))
  assert.deepEqual(local, original)
  assert.equal((await preview({ accountId, local: result.candidate, witnessedEvents: [evidence(3)] })).status, 'unchanged')
})
test('sparse historical evidence cannot erase a richer existing scheduler or its unknown fields', async () => {
  const local = snapshot([
    evidence(1, 'alpha', { attemptId: undefined, sourceMode: undefined, reviewRatingDecision: undefined, wrongCount: 0 }),
  ])
  const richer = {
    id: 17,
    dict: 'school',
    word: 'alpha',
    reviewCount: 9,
    lastReviewedAt: 1800000000,
    nextReviewAt: 1900000000,
    lifecycle: 'active',
    schedulerState: { kind: 'basic-v2', stage: 4, intervalDays: 14 },
    historicalExtension: { keep: true },
  }
  rows(local, 'reviewWordStates').push(richer)
  const result = await preview({ accountId, local, witnessedEvents: [evidence(3)] })
  assert.equal(result.status, 'candidate', result.reason)
  assert.equal(result.newlyAdoptedAttempts, 1)
  assert.equal(result.retainedLegacyStates, 1)
  assert.deepEqual(rows(result.candidate, 'reviewWordStates'), [richer])
  assert.deepEqual(rows(result.candidate, 'wordRecords')[0], rows(local, 'wordRecords')[0])
  assert.equal((await preview({ accountId, local: result.candidate, witnessedEvents: [evidence(3)] })).status, 'unchanged')
})
test('known legacy UUID cannot silently merge contradictory modern evidence', async () => {
  const local = snapshot([evidence(1, 'alpha', { sourceMode: undefined })])
  const result = await preview({ accountId, local, witnessedEvents: [evidence(1)] })
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'm4-prefix-conflicting-local-attempt')
})
