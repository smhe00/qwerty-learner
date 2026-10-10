/* eslint-env node */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('../../', import.meta.url))
const folder = mkdtempSync(join(tmpdir(), 'qwerty-p3b-archive-'))
const target = join(folder, 'archive.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/v2-recovery-archive.ts')],
  outfile: target, bundle: true, platform: 'node', target: 'node20', format: 'esm',
})
after(() => rmSync(folder, { recursive: true, force: true }))
const { verifyPinnedCloudArchive, convertVerifiedCloudV3ToV4, samePinnedRemote } =
  await import(pathToFileURL(target).href)

const owner = 'p3b-account-owner'
const TABLES = ['wordRecords','chapterRecords','reviewRecords','reviewWordStates',
  'achievementEvents','achievementStates']
function snapshot(names = TABLES) {
  return {
    backupFormatVersion: 'qwerty-backup-v3',
    learningState: { currentDict: 'zhongkaohexin', currentChapter: 7 },
    database: {
      formatName: 'dexie',
      data: {
        tables: names.map(name => ({ name, schema: '++id' })),
        data: [{ tableName: 'wordRecords', inbound: true,
          rows: [{ id: 1, word: 'careful' }] }],
      },
    },
  }
}
function archive(value) {
  const bytes = gzipSync(Buffer.from(JSON.stringify(value)))
  const sha = createHash('sha256').update(bytes).digest('hex')
  const meta = {
    hasData: true, revision: 4, sizeBytes: bytes.length,
    payloadSha256: sha, dataSha256: sha,
    logicalFingerprint: null, clientFormatVersion: 'qwerty-backup-v3',
  }
  const remote = { ...meta, payloadEncoding: 'base64', payloadBase64: bytes.toString('base64') }
  return { meta, remote, bytes }
}

test('P3b V3 archive is SHA+revision pinned and converts a complete six-table snapshot', async () => {
  const input = archive(snapshot())
  const raw = await verifyPinnedCloudArchive(input.meta, input.remote)
  assert.equal(Buffer.from(raw).equals(input.bytes), true)
  const converted = await convertVerifiedCloudV3ToV4(raw, owner)
  assert.equal(converted.backupFormatVersion, 'qwerty-backup-v4')
  assert.deepEqual(converted.metadata.source, { kind: 'account', accountId: owner })
  assert.equal(converted.workspaceData.navigation.currentChapter, 7)
  assert.equal(converted.workspaceData.database.data.data[0].rows[0].word, 'careful')
})

test('P3b rejects truncated V3 manifests that would clear unsupplied learning tables', async () => {
  const partial = archive(snapshot(TABLES.filter(name => name !== 'reviewWordStates')))
  const raw = await verifyPinnedCloudArchive(partial.meta, partial.remote)
  await assert.rejects(convertVerifiedCloudV3ToV4(raw, owner), /missing or duplicate durable tables/)
})

test('P3b refuses modified remote revision, transport SHA, format, and Base64', async () => {
  const { meta, remote } = archive(snapshot())
  assert.equal(samePinnedRemote(meta, { ...meta, revision: 5 }), false)
  for (const tampered of [
    { ...remote, revision: 5 },
    { ...remote, payloadSha256: '0'.repeat(64) },
    { ...remote, clientFormatVersion: 'qwerty-dexie-gzip-v2' },
    { ...remote, payloadBase64: '%broken%' },
  ]) {
    await assert.rejects(verifyPinnedCloudArchive(meta, tampered))
  }
})

test('P3b bounded decompression fails closed on oversized legacy backups', async () => {
  const huge = snapshot()
  huge.padding = 'A'.repeat(33 * 1024 * 1024)
  const input = archive(huge)
  const raw = await verifyPinnedCloudArchive(input.meta, input.remote)
  await assert.rejects(convertVerifiedCloudV3ToV4(raw, owner),
    /maximum inflated size/)
})
