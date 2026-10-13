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
const { verifyPinnedCloudArchive, samePinnedRemote } =
  await import(pathToFileURL(target).href)

const TABLES = ['wordRecords','chapterRecords','reviewRecords','reviewWordStates',
  'achievementEvents','achievementStates']
function snapshot(names = TABLES) {
  return {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { source: { kind: 'account', accountId: 'p3b-test-owner' }, createdAt: '2026-10-13' },
    workspaceData: { database: {
      formatName: 'dexie',
      data: {
        tables: names.map(name => ({ name, schema: '++id' })),
        data: [{ tableName: 'wordRecords', inbound: true,
          rows: [{ id: 1, word: 'careful' }] }],
      },
    }, learnRuntime: { dailySessions: {} }, settings: { version: 1, values: {} },
    navigation: { currentDict: 'zhongkaohexin', currentChapter: 7 } },
  }
}
function archive(value) {
  const bytes = gzipSync(Buffer.from(JSON.stringify(value)))
  const sha = createHash('sha256').update(bytes).digest('hex')
  const meta = {
    hasData: true, revision: 4, sizeBytes: bytes.length,
    payloadSha256: sha, dataSha256: sha,
    logicalFingerprint: 'a'.repeat(64), clientFormatVersion: 'qwerty-backup-v4',
  }
  const remote = { ...meta, payloadEncoding: 'base64', payloadBase64: bytes.toString('base64') }
  return { meta, remote, bytes }
}

test('V4 archive is pinned to the exact SHA, revision and bytes', async () => {
  const input = archive(snapshot())
  const raw = await verifyPinnedCloudArchive(input.meta, input.remote)
  assert.equal(Buffer.from(raw).equals(input.bytes), true)
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

test('obsolete cloud formats fail closed without exporting bytes', async () => {
  const { meta, remote } = archive(snapshot())
  await assert.rejects(verifyPinnedCloudArchive({ ...meta, clientFormatVersion: 'qwerty-backup-v3' },
    { ...remote, clientFormatVersion: 'qwerty-backup-v3' }))
})
