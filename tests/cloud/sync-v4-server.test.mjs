/* eslint-env node */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { verifyCompressedV4 } from '../../cloud-functions/_shared/sync-v4.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-v4-parity-'))
const target = join(tmp, 'canonical.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/workspace-v4.ts')],
  outfile: target, platform: 'node', format: 'esm', bundle: true, target: 'node20' })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { createWorkspaceV4, workspaceFingerprintV4 } =
  await import(pathToFileURL(target).href)
const owner = 'test-immutable-owner'
function sample() {
  return createWorkspaceV4({
    database: { formatName: 'dexie', formatVersion: 1, data: {
      databaseName: 'RecordDB', databaseVersion: 6,
      tables: [{ name: 'wordRecords', schema: '++id' },
        { name: 'reviewWordStates', schema: '++id' }],
      data: [
        { tableName: 'wordRecords', inbound: true,
          rows: [{ id: 2, word: '漢字' }, { id: 1, word: 'alpha' }] },
        { tableName: 'reviewWordStates', inbound: true,
          rows: [{ id: 4, word: 'beta', nextReviewAt: 42 }] },
      ],
    } },
    navigation: { currentDict: '中考', currentChapter: 3 },
    settings: { version: 1, values: { memoryConfig: { blockSize: 1 } } },
    learnRuntime: { dailySessions: {} },
  }, { source: { kind: 'account', accountId: owner }, createdAt: '2026-10-10T00:00:00Z' })
}
const zipped = value => gzipSync(Buffer.from(JSON.stringify(value), 'utf8'))

test('V4 Node server digest equals canonical browser fingerprint', async () => {
  const snapshot = sample()
  const hash = await workspaceFingerprintV4(snapshot)
  const verified = verifyCompressedV4(zipped(snapshot), owner, hash)
  assert.equal(verified.logicalFingerprint, hash)
  assert.equal(verified.snapshot.metadata.source.accountId, owner)
})

test('V4 canonical digest ignores row/table order and metadata only', async () => {
  const a = sample()
  const b = structuredClone(a)
  b.metadata.createdAt = '2027-04-09T11:01:45Z'
  b.workspaceData.database.data.tables.reverse()
  b.workspaceData.database.data.data.reverse()
  b.workspaceData.database.data.data[1].rows.reverse()
  const expected = await workspaceFingerprintV4(a)
  assert.equal(await workspaceFingerprintV4(b), expected)
  assert.equal(verifyCompressedV4(zipped(b), owner, expected).logicalFingerprint, expected)
})

test('V4 owner forgery, wrong digest, malformed settings, or zip payload are rejected', async () => {
  const valid = sample()
  const hash = await workspaceFingerprintV4(valid)
  assert.throws(() => verifyCompressedV4(zipped(valid), 'another-owner', hash), /identity/)
  assert.throws(() => verifyCompressedV4(zipped(valid), owner, 'f'.repeat(64)), /fingerprint/)
  const forged = structuredClone(valid)
  forged.workspaceData.settings.values['qwerty.cloudAuth.v1'] = { token: 'LEAK' }
  assert.throws(() => verifyCompressedV4(zipped(forged), owner, hash), /setting/)
  assert.throws(() => verifyCompressedV4(Buffer.from('not gzip'), owner, hash), /gzip/)
})

test('canonical V4 includes settings, DailySession and navigation in the digest', async () => {
  const snapshot = sample()
  const original = await workspaceFingerprintV4(snapshot)
  for (const changed of [
    s => { s.workspaceData.settings.values.memoryConfig.blockSize = 9 },
    s => { s.workspaceData.navigation.currentChapter = 12 },
  ]) {
    const variant = structuredClone(snapshot)
    changed(variant)
    const newDigest = await workspaceFingerprintV4(variant)
    assert.notEqual(newDigest, original)
    assert.equal(verifyCompressedV4(zipped(variant), owner, newDigest).logicalFingerprint, newDigest)
  }
})
