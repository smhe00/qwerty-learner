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
