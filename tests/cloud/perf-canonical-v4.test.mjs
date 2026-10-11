/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { verifyCompressedV4 } from '../../cloud-functions/_shared/sync-v4.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-perf-fingerprint-'))
const out = join(tmp, 'workspace-v4.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/workspace-v4.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node20' })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { workspaceFingerprintV4, stableWorkspaceJson } = await import(pathToFileURL(out).href)

// Historical algorithm prior to sort-key caching. Its exact comparison
// semantics, including localeCompare and stable ties, must remain unchanged.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function historicalCanonicalData(data) {
  const db = data.database
  const root = record(db.data) ? db.data : null
  let logicalDatabase = db
  if (root && Array.isArray(root.tables) && Array.isArray(root.data)) {
    logicalDatabase = {
      tables: [...root.tables].sort((a, b) =>
        stableWorkspaceJson(record(a) ? a.name : a)
          .localeCompare(stableWorkspaceJson(record(b) ? b.name : b))),
      data: root.data.map(entry => {
        if (!record(entry) || !Array.isArray(entry.rows)) return entry
        return { ...entry, rows: [...entry.rows].sort((a, b) =>
          stableWorkspaceJson(a).localeCompare(stableWorkspaceJson(b))) }
      }).sort((a, b) =>
        stableWorkspaceJson(record(a) ? a.tableName : a)
          .localeCompare(stableWorkspaceJson(record(b) ? b.tableName : b))),
    }
  }
  return {
    database: logicalDatabase, learnRuntime: data.learnRuntime,
    settings: data.settings, navigation: data.navigation,
  }
}
function oldHash(snapshot) {
  return crypto.createHash('sha256')
    .update(stableWorkspaceJson(historicalCanonicalData(snapshot.workspaceData)), 'utf8')
    .digest('hex')
}
const accountId = 'test-owner'
const names = [
  'wordRecords', 'chapterRecords', 'reviewRecords',
  'reviewWordStates', 'achievementEvents', 'achievementStates',
]
function snapshot(reverse = false) {
  const words = Array.from({ length: 225 }, (_, id) => ({
    id: id + 1, word: ['alpha', 'βeta', '中文', 'école', '新词'][id % 5],
    dict: 'shanghai-zhongkao-2027', reviewCount: id % 9,
    metadata: { lastReview: id * 100, hint: id % 3 },
  }))
  if (reverse) words.reverse()
  const tables = names.map(name => ({ name, schema: '++id' }))
  const data = [
    { tableName: 'wordRecords', rows: words },
    { tableName: 'reviewRecords', rows: [
      { id: 11, notes: '中文内容' }, { id: 4, notes: 'quoted \\u1234' },
    ] },
    { tableName: 'achievementEvents', rows: [
      { eventId: 'test', other: { k: ['α', '字'] } },
    ] },
  ]
  if (reverse) { tables.reverse(); data.reverse() }
  return {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-11T10:00:00.000Z',
      source: { kind: 'account', accountId } },
    workspaceData: {
      database: { formatName: 'dexie', formatVersion: 1,
        data: { databaseName: 'RecordDB', databaseVersion: 6, tables, data } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: { memoryConfig: { dailyNewWordTarget: 32 } } },
      navigation: { currentDict: 'shanghai-zhongkao-2027', currentChapter: 0 },
    },
  }
}

test('optimized browser fingerprints equal historical fingerprints across row permutations', async () => {
  const a = snapshot(false)
  const b = snapshot(true)
  assert.equal(oldHash(a), oldHash(b))
  assert.equal(await workspaceFingerprintV4(a), oldHash(a))
  assert.equal(await workspaceFingerprintV4(b), oldHash(b))
})

test('EdgeOne V4 verifier accepts old canonical fingerprint for optimized browser snapshot', async () => {
  for (const reversed of [false, true]) {
    const s = snapshot(reversed)
    const hash = oldHash(s)
    const verified = verifyCompressedV4(gzipSync(JSON.stringify(s)), accountId, hash)
    assert.equal(verified.logicalFingerprint, hash)
    assert.equal(await workspaceFingerprintV4(verified.snapshot), hash)
  }
})
