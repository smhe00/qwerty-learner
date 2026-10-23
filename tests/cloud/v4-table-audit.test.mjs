import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'p4b-v4-table-audit-'))
const out = join(tmp, 'audit.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v4-table-audit.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20' })
after(() => rmSync(tmp, { recursive: true, force: true }))
const {
  assertV4ExportMatchesSource, assertV4SourceRowsMatchExport,
  exportedV4TableCounts, v4TableRowDigests,
} = await import(pathToFileURL(out).href)

const names = ['wordRecords', 'chapterRecords', 'reviewRecords',
  'reviewWordStates', 'achievementEvents', 'achievementStates']
const fixture = () => ({
  backupFormatVersion: 'qwerty-backup-v4',
  metadata: { createdAt: '2026-10-10', source: { kind: 'account', accountId: 'a' } },
  workspaceData: {
    database: { formatName: 'dexie', data: {
      tables: names.map(name => ({ name, schema: '++id' })),
      data: [
        { tableName: 'wordRecords', inbound: true, rows: [
          { id: 2, word: 'β' }, { id: 1, word: 'alpha' },
        ] },
        { tableName: 'reviewWordStates', inbound: true, rows: [{ id: 1, word: 'β' }] },
      ],
    } },
    learnRuntime: { dailySessions: {} }, settings: { version: 1, values: {} },
    navigation: { currentDict: 'zhongkaohexin', currentChapter: 0 },
  },
})

test('P4b audit counts all six tables including implicit empty exported tables', () => {
  const snapshot = fixture()
  const counts = exportedV4TableCounts(snapshot)
  assert.deepEqual(Object.fromEntries(Object.entries(counts).sort()),
    Object.fromEntries(Object.entries({
      wordRecords: 2, chapterRecords: 0, reviewRecords: 0,
      reviewWordStates: 1, achievementEvents: 0, achievementStates: 0,
    }).sort()))
  assert.deepEqual(assertV4ExportMatchesSource(snapshot, counts), counts)
})

test('P4b rejects silent lost rows even when six-table manifest and SHA are valid', () => {
  const snapshot = fixture()
  const before = exportedV4TableCounts(snapshot)
  snapshot.workspaceData.database.data.data[0].rows.pop()
  assert.throws(() => assertV4ExportMatchesSource(snapshot, before),
    /source\/export row-count mismatch: wordRecords/)
  assert.throws(() => assertV4ExportMatchesSource(fixture(),
    { ...before, achievementStates: 2 }),
  /source\/export row-count mismatch: achievementStates/)
})

test('P4b per-table digest detects same-count replacement but ignores export row order', async () => {
  const before = fixture()
  const after = fixture()
  after.workspaceData.database.data.data[0].rows.reverse()
  assert.deepEqual(await v4TableRowDigests(before), await v4TableRowDigests(after))
  after.workspaceData.database.data.data[0].rows[0].word = 'wrong-data'
  assert.notEqual((await v4TableRowDigests(before)).wordRecords,
    (await v4TableRowDigests(after)).wordRecords)
})

test('P4b live row hash rejects same-count FSRS corruption without accepting export SHA', async () => {
  const snapshot = fixture()
  const actual = Object.fromEntries(names.map(name => [
    name, structuredClone(snapshot.workspaceData.database.data.data
      .find(group => group.tableName === name)?.rows ?? []),
  ]))
  await assertV4SourceRowsMatchExport(snapshot, actual)
  snapshot.workspaceData.database.data.data[1].rows[0].word = 'silently-altered-fsrs'
  await assert.rejects(
    () => assertV4SourceRowsMatchExport(snapshot, actual),
    /source\/export row-payload mismatch: reviewWordStates/,
  )
  snapshot.workspaceData.database.data.data[1].rows.pop()
  await assert.rejects(
    () => assertV4SourceRowsMatchExport(snapshot, actual),
    /source\/export row-count mismatch: reviewWordStates/,
  )
})

test('P4b ignores Dexie transport-only $types but verifies all actual stored columns', async () => {
  const snapshot = fixture()
  const sources = Object.fromEntries(names.map(name => [
    name, structuredClone(snapshot.workspaceData.database.data.data
      .find(group => group.tableName === name)?.rows ?? []),
  ]))
  snapshot.workspaceData.database.data.data[0].rows[0].$types = {
    someDexieTransportMarker: 'serialization-only',
  }
  await assertV4SourceRowsMatchExport(snapshot, sources)
  snapshot.workspaceData.database.data.data[0].rows[0].word = 'changed'
  await assert.rejects(() => assertV4SourceRowsMatchExport(snapshot, sources),
    /source\/export row-payload mismatch: wordRecords/)
})


test('P4b: Dexie Typeson NaN/undefined telemetry survives auditable V4 export', async () => {
  const snapshot = fixture()
  const plain = snapshot.workspaceData.database.data.data[0].rows[0]
  const actualWord = {
    ...plain,
    typingTelemetry: {
      telemetryVersion: 2, firstKeyLatencyMs: NaN,
      attempts: [
        {
          startLatencyMs: Infinity, durationMs: 90,
          correctPrefixLength: 0, result: 'wrong',
          wrongIndex: undefined, interKeyIntervalsMs: [12, NaN],
        },
      ],
    },
  }
  const actual = Object.fromEntries(names.map(name => [
    name, structuredClone(snapshot.workspaceData.database.data.data
      .find(group => group.tableName === name)?.rows ?? []),
  ]))
  actual.wordRecords[0] = actualWord

  // Mirrors Dexie/Typeson representation: values tagged in $types,
  // including nested path components, are reversibly encoded.
  plain.typingTelemetry = {
    telemetryVersion: 2, firstKeyLatencyMs: 'NaN',
    attempts: [
      {
        startLatencyMs: 'Infinity', durationMs: 90,
        correctPrefixLength: 0, result: 'wrong',
        wrongIndex: 0, interKeyIntervalsMs: [12, 'NaN'],
      },
    ],
  }
  plain.$types = {
    '': 'userObject',
    'typingTelemetry.attempts': 'arrayNonindexKeys',
    'typingTelemetry.attempts.0.interKeyIntervalsMs': 'arrayNonindexKeys',
    'typingTelemetry.firstKeyLatencyMs': 'nan',
    'typingTelemetry.attempts.0.startLatencyMs': 'infinity',
    'typingTelemetry.attempts.0.wrongIndex': 'undef',
    'typingTelemetry.attempts.0.interKeyIntervalsMs.1': 'nan',
  }
  await assertV4SourceRowsMatchExport(snapshot, actual)
  assert.equal(plain.typingTelemetry.firstKeyLatencyMs, 'NaN',
    'comparison must never mutate the backup transport payload')

  // Even when a difference occurs in a tagged object, a true changed
  // telemetry metric must still make the export fail closed.
  plain.typingTelemetry.attempts[0].durationMs = 99
  await assert.rejects(
    () => assertV4SourceRowsMatchExport(snapshot, actual),
    /row-payload mismatch: wordRecords.*typingTelemetry/,
  )
})

test('P4b: forged special-type metadata cannot hide a missing/changed metric', async () => {
  const snapshot = fixture()
  const actual = Object.fromEntries(names.map(name => [
    name, structuredClone(snapshot.workspaceData.database.data.data
      .find(group => group.tableName === name)?.rows ?? []),
  ]))
  snapshot.workspaceData.database.data.data[0].rows[0].$types = {
    word: 'undef',
  }
  snapshot.workspaceData.database.data.data[0].rows[0].word = null
  await assert.rejects(
    () => assertV4SourceRowsMatchExport(snapshot, actual),
    /row-payload mismatch: wordRecords/,
  )
})


test('P4b Typeson # alias in a real Learn-style repeated-word session is audited without deleting evidence', async () => {
  const snapshot = fixture()
  const sharedWord = { name: 'identical', trans: ['meaning'], index: 3 }
  const liveSession = {
    id: 7, dict: 'school', sessionId: 'test-session',
    index: 1, isFinished: false, words: [sharedWord, sharedWord],
  }
  const review = { tableName: 'reviewRecords', inbound: true, rows: [
    structuredClone(liveSession),
  ] }
  snapshot.workspaceData.database.data.data.push(review)
  const raw = Object.fromEntries(names.map(name => [
    name, structuredClone(snapshot.workspaceData.database.data.data
      .find(group => group.tableName === name)?.rows ?? []),
  ]))
  review.rows[0].words = [structuredClone(sharedWord), '#words.0']
  review.rows[0].$types = {
    '': 'userObject', words: 'arrayNonindexKeys', 'words.1': '#',
  }

  await assertV4SourceRowsMatchExport(snapshot, raw)
  assert.equal(review.rows[0].words[1], '#words.0',
    'comparison must not remove Typeson alias markers from the backup')
  assert.equal(review.rows[0].$types['words.1'], '#')
})

test('P4b # alias cannot forge object identity or conceal a changed word', async () => {
  const snapshot = fixture()
  const shared = { name: 'identical', trans: ['meaning'] }
  const exported = { id: 10, words: [structuredClone(shared), '#words.0'],
    $types: { '': 'userObject', 'words.1': '#' } }
  snapshot.workspaceData.database.data.data.push({
    tableName: 'reviewRecords', inbound: true, rows: [exported],
  })
  const original = Object.fromEntries(names.map(name => [
    name, structuredClone(snapshot.workspaceData.database.data.data
      .find(group => group.tableName === name)?.rows ?? []),
  ]))
  const rawSession = { id: 10, words: [shared, shared] }
  original.reviewRecords = [rawSession]
  await assertV4SourceRowsMatchExport(snapshot, original)

  // Equal-looking but independently allocated words are NOT a valid alias.
  original.reviewRecords = [{
    id: 10, words: [structuredClone(shared), structuredClone(shared)],
  }]
  await assert.rejects(() => assertV4SourceRowsMatchExport(snapshot, original),
    /row-payload mismatch: reviewRecords/)

  original.reviewRecords = [rawSession]
  exported.words[0].name = 'modified'
  await assert.rejects(() => assertV4SourceRowsMatchExport(snapshot, original),
    /row-payload mismatch: reviewRecords/)
  exported.words[0].name = 'identical'
  exported.words[1] = '#words.999'
  await assert.rejects(() => assertV4SourceRowsMatchExport(snapshot, original),
    /row-payload mismatch: reviewRecords/)
})
