import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-v4-'))
const target = join(tmp, 'v4.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/workspace-v4.ts')],
  outfile: target, bundle: true, platform: 'node', target: 'node20', format: 'esm' })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { WORKSPACE_V4_FORMAT, captureWorkspaceSettings, captureDailySessions,
  createWorkspaceV4, migrateV3ToWorkspaceV4, parseWorkspaceV4, workspaceFingerprintV4
} = await import(pathToFileURL(target).href)

const source = { kind: 'account', accountId: 'a-fresh-id-1' }
const metadata = { source, createdAt: '2026-10-09T00:00:00.000Z' }
const db = {
  formatName: 'dexie',
  formatVersion: 1,
  data: {
    databaseName: 'RecordDB',
    databaseVersion: 5,
    tables: [
      { name: 'reviewWordStates', schema: '++id' },
      { name: 'wordRecords', schema: '++id' },
    ],
    data: [
      { tableName: 'wordRecords', inbound: true, rows: [{ id: 2, word: 'b' }, { id: 1, word: 'a' }] },
      { tableName: 'reviewWordStates', inbound: true, rows: [{ id: 3, word: 'z', nextReviewAt: 42 }] },
    ],
  },
}
const daily = {
  version: 1, sessionId: 'dict:today:1', dict: 'dict', dateKey: '2026-10-09',
  startedAt: 100, status: 'active', dailyNewTarget: 20, plannedNewWords: 5,
  plannedReviewWords: ['a'], carryOverAcquisitionWords: ['b'],
  accumulatedActiveSeconds: 70, completedBlockIds: ['block-1'],
  blockCount: 1,
}
function storage(entries) {
  const m = new Map(Object.entries(entries))
  return { length: m.size, key: index => [...m.keys()][index] ?? null,
    getItem: key => m.get(key) ?? null }
}
const store = storage({
  'currentDict': '"dict"',
  'memoryConfig': '{"dailyNewWordTarget":32,"blockSize":1}',
  'keySoundsConfig': '{"isOpen":true}',
  'qwerty.cloudAuth.v1': '{"token":"SECRET"}',
  'qwerty.cloudSyncState.v1.a1': '{"baseRevision":99}',
  'reviewModeInfo': '{"isReviewMode":true}',
  'qwerty.learn.dailySession.v1.dict': JSON.stringify(daily),
})

test('settings and runtime captures are allowlisted and exclude credentials', () => {
  const settings = captureWorkspaceSettings(store)
  const sessions = captureDailySessions(store)
  assert.deepEqual(Object.keys(settings.values).sort(), ['keySoundsConfig', 'memoryConfig'])
  assert.deepEqual(sessions.dict, daily)
  assert.ok(!JSON.stringify(settings).includes('SECRET'))
  assert.ok(!JSON.stringify(sessions).includes('SECRET'))
})

test('V3 migrates to V4 without destroying unfinished DailySession or preferences', () => {
  const legacy = JSON.stringify({
    backupFormatVersion: 'qwerty-backup-v3',
    database: db, learningState: { currentDict: 'dict', currentChapter: 4 },
  })
  const result = migrateV3ToWorkspaceV4(legacy, metadata, { storage: store })
  assert.equal(result.backupFormatVersion, WORKSPACE_V4_FORMAT)
  assert.equal(result.workspaceData.navigation.currentChapter, 4)
  assert.deepEqual(result.workspaceData.learnRuntime.dailySessions.dict, daily)
  assert.deepEqual(result.workspaceData.database, db)
  assert.deepEqual(parseWorkspaceV4(JSON.stringify(result)), JSON.parse(JSON.stringify(result)))
  const historical = migrateV3ToWorkspaceV4(legacy, metadata)
  assert.equal(Object.keys(historical.workspaceData.learnRuntime.dailySessions).length, 0)
  assert.equal(Object.keys(historical.workspaceData.settings.values).length, 0)
})

test('V4 fingerprint ignores metadata, object keys, Dexie row and table ordering', async () => {
  const data = {
    database: db,
    learnRuntime: { dailySessions: { dict: daily } },
    settings: captureWorkspaceSettings(store),
    navigation: { currentDict: 'dict', currentChapter: 4 },
  }
  const v4 = createWorkspaceV4(data, metadata)
  const clone = JSON.parse(JSON.stringify(v4))
  clone.metadata.createdAt = '2026-10-10T00:00:00Z'
  clone.workspaceData.database.data.tables.reverse()
  clone.workspaceData.database.data.data.reverse()
  clone.workspaceData.database.data.data.find(x => x.tableName === 'wordRecords').rows.reverse()
  assert.equal(await workspaceFingerprintV4(v4), await workspaceFingerprintV4(clone))
  clone.workspaceData.navigation.currentChapter = 5
  assert.notEqual(await workspaceFingerprintV4(v4), await workspaceFingerprintV4(clone))
})

test('malformed durable session is rejected, not dropped', () => {
  assert.throws(() => captureDailySessions(storage({
    'qwerty.learn.dailySession.v1.dict': '{broken'
  })), /Corrupt durable DailySession/)
})

test('malicious/unknown setting names or forged identity cannot enter V4', () => {
  const valid = createWorkspaceV4({
    database: db, learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'dict', currentChapter: 0 },
  }, metadata)
  const forged = JSON.parse(JSON.stringify(valid))
  forged.workspaceData.settings.values['qwerty.cloudAuth.v1'] = { token: 'secret' }
  assert.throws(() => parseWorkspaceV4(JSON.stringify(forged)), /Disallowed workspace setting/)
  forged.workspaceData.settings.values = {}
  forged.metadata.source = { kind: 'account', accountId: '' }
  assert.throws(() => parseWorkspaceV4(JSON.stringify(forged)), /Invalid Backup V4 envelope/)
  assert.throws(() => migrateV3ToWorkspaceV4('{"backupFormatVersion":"qwerty-backup-v2"}', metadata))
})
