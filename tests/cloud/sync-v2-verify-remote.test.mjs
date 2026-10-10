/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-v2-pull-check-'))
const bundle = join(tmp, 'v2check.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v2-verify-remote.ts')],
  outfile: bundle, bundle: true, platform: 'node', target: 'node20', format: 'esm' })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { verifyDownloadedWorkspaceV4 } = await import(pathToFileURL(bundle).href)
const owner = 'immutable-owner'
const TABLES = ['achievementEvents','achievementStates','chapterRecords','reviewRecords','reviewWordStates','wordRecords']
const snapshot = {
  backupFormatVersion: 'qwerty-backup-v4',
  metadata: { createdAt: '2026-10-10', source: { kind: 'account', accountId: owner } },
  workspaceData: {
    database: { formatName: 'dexie', data: { tables: TABLES.map(name => ({ name, schema: '++id' })), data: [] } },
    settings: { version: 1, values: {} },
    learnRuntime: { dailySessions: {} },
    navigation: { currentDict: 'zhongkaohexin', currentChapter: 0 },
  },
}
function fixture() {
  const bytes = gzipSync(Buffer.from(JSON.stringify(snapshot)))
  const fingerprintInput = {
    database: { tables: TABLES.map(name => ({ name, schema: '++id' })), data: [] },
    learnRuntime: { dailySessions: {} },
    navigation: { currentDict: 'zhongkaohexin', currentChapter: 0 },
    settings: { version: 1, values: {} },
  }
  const stable = value => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  const canonicalJson = stable(fingerprintInput)
  const meta = {
    hasData: true, revision: 4, logicalFingerprint: crypto.createHash('sha256')
      .update(canonicalJson).digest('hex'),
    payloadSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length, clientFormatVersion: 'qwerty-backup-v4',
  }
  return { meta, remote: { ...meta, payloadBase64: bytes.toString('base64'), payloadEncoding: 'base64' } }
}

test('verified V4 cloud payload returns parsed copy but never modifies learning data', async () => {
  const { meta, remote } = fixture()
  const result = await verifyDownloadedWorkspaceV4(owner, meta, remote)
  assert.deepEqual(result, snapshot)
})

test('newer remote revision between meta and download fails closed', async () => {
  const { meta, remote } = fixture()
  await assert.rejects(verifyDownloadedWorkspaceV4(owner, meta, { ...remote, revision: 5 }),
    /metadata changed/)
})

test('tampered gzip bytes and mismatched hashes are rejected', async () => {
  const { meta, remote } = fixture()
  await assert.rejects(verifyDownloadedWorkspaceV4(owner, meta, {
    ...remote, payloadBase64: Buffer.from('not valid gzip').toString('base64'),
  }), /size mismatch|checksum/)
  await assert.rejects(verifyDownloadedWorkspaceV4(owner, meta, {
    ...remote, payloadSha256: 'f'.repeat(64),
  }), /metadata changed/)
  await assert.rejects(verifyDownloadedWorkspaceV4(owner, {
    ...meta, logicalFingerprint: 'f'.repeat(64),
  }, { ...remote, logicalFingerprint: 'f'.repeat(64) }), /canonical fingerprint/)
})

test('account ownership mismatch cannot restore another user data', async () => {
  const { meta, remote } = fixture()
  await assert.rejects(verifyDownloadedWorkspaceV4('wrong-owner', meta, remote),
    /owner mismatch/)
})

test('oversized, malformed and old-format V4 payloads are blocked', async () => {
  const { meta, remote } = fixture()
  await assert.rejects(verifyDownloadedWorkspaceV4(owner, meta, {
    ...remote, payloadBase64: '%INVALID%',
  }), /Base64/)
  await assert.rejects(verifyDownloadedWorkspaceV4(owner, {
    ...meta, clientFormatVersion: 'qwerty-backup-v3',
  }, remote), /format unsupported/)
  await assert.rejects(verifyDownloadedWorkspaceV4(owner, meta, {
    ...remote, payloadBase64: 'A'.repeat(6 * 1024 * 1024),
  }), /Base64/)
})
