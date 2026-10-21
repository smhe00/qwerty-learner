import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-m2-ff-'))
const out = join(dir, 'fast-forward.mjs')
const ws = join(dir, 'workspace.mjs')
await Promise.all([
  build({ entryPoints: [resolve(root, 'src/sync/v4-fast-forward-preview.ts')],
    outfile: out, bundle: true, platform: 'node', format: 'esm',
    target: 'node20', tsconfig: resolve(root, 'tsconfig.json') }),
  build({ entryPoints: [resolve(root, 'src/sync/workspace-v4.ts')],
    outfile: ws, bundle: true, platform: 'node', format: 'esm',
    target: 'node20', tsconfig: resolve(root, 'tsconfig.json') }),
])
after(() => rmSync(dir, { recursive: true, force: true }))
const { inspectPinnedV4FastForward: project } =
  await import(pathToFileURL(out).href)
const { workspaceFingerprintV4: fingerprint } =
  await import(pathToFileURL(ws).href)
const accountId = 'immutable-a'
const tables = ['wordRecords', 'chapterRecords', 'reviewRecords',
  'reviewWordStates', 'achievementEvents', 'achievementStates']
function snap(word = 'original', owner = accountId) {
  return {
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-22T00:00:00Z',
      source: { kind: 'account', accountId: owner } },
    workspaceData: {
      database: { formatName: 'dexie', formatVersion: 1, data: {
        databaseName: 'RecordDB', databaseVersion: 6,
        tables: tables.map(name => ({ name, schema: '++id' })),
        data: tables.map(tableName => ({
          tableName, inbound: true,
          rows: tableName === 'wordRecords' ?
            [{ id: 1, word, dict: 'school', timeStamp: 1800000000 }] :
            tableName === 'reviewRecords' ?
              [{ id: 1, index: 0, isFinished: false, words: [] }] : [],
        })),
      } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: {} },
      navigation: { currentDict: 'school', currentChapter: 0 },
    },
  }
}
async function inspect(ancestor, local, remote, override) {
  return project({ accountId, pinnedAncestorFingerprint:
    override ?? await fingerprint(ancestor), ancestor, local, remote })
}
test('remote-only full V4 update yields detached six-table preview without publish authority', async () => {
  const ancestor = snap()
  const local = structuredClone(ancestor)
  const remote = snap('remote-progress')
  const source = structuredClone({ ancestor, local, remote })
  const result = await inspect(ancestor, local, remote)
  assert.equal(result.status, 'projected', result.reason)
  assert.equal(result.selected, 'remote')
  assert.equal(result.publishReady, false)
  assert.equal(result.convergenceComplete, false)
  assert.equal(result.candidate.workspaceData.database.data.data.length, 6)
  assert.equal(await fingerprint(result.candidate), await fingerprint(remote))
  result.candidate.workspaceData.database.data.data[0].rows[0].word = 'modified'
  assert.deepEqual({ ancestor, local, remote }, source)
})
test('local-only change, identical changes and identical idle snapshots are deterministic', async () => {
  const ancestor = snap()
  assert.equal((await inspect(ancestor, snap('local'), ancestor)).selected, 'local')
  assert.equal((await inspect(ancestor, ancestor, ancestor)).selected, 'identical')
  assert.equal((await inspect(ancestor, snap('both'), snap('both'))).selected, 'identical')
})
test('both divergent V4 heads must not silently pick a side', async () => {
  const ancestor = snap()
  const result = await inspect(ancestor, snap('local'), snap('remote'))
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'both-devices-changed-requires-six-table-merge')
  assert.equal(result.candidate, undefined)
})
test('forged ancestor pin, invalid SHA and different immutable account are blocked', async () => {
  const baseline = snap()
  assert.equal((await inspect(baseline, baseline, baseline, 'a'.repeat(64)))
    .reason, 'ancestor-pinned-fingerprint-mismatch')
  assert.equal((await inspect(baseline, baseline, baseline, 'not-sha'))
    .reason, 'ancestor-pin-invalid')
  assert.equal((await inspect(baseline, baseline, snap('other','account-B')))
    .reason, 'ancestor-workspace-account-mismatch')
})
test('missing table payload is rejected even when the six-table manifest exists', async () => {
  const ancestor = snap()
  const bad = structuredClone(ancestor)
  bad.workspaceData.database.data.data.pop()
  assert.equal((await inspect(ancestor, ancestor, bad)).reason,
    'ancestor-incomplete-six-table-export')
  const broken = structuredClone(ancestor)
  broken.workspaceData.database.data.data[1].tableName = 'wordRecords'
  assert.equal((await inspect(ancestor, broken, ancestor)).reason,
    'ancestor-incomplete-six-table-export')
})
test('schema mismatch cannot be reinterpreted as a harmless one-sided update', async () => {
  const ancestor = snap()
  const foreign = structuredClone(ancestor)
  foreign.workspaceData.database.data.tables[0].schema = 'id'
  assert.equal((await inspect(ancestor, ancestor, foreign)).reason,
    'ancestor-dexie-schema-divergence')
})
test('changes in daily sessions or preferences count as divergence, never discarded', async () => {
  const ancestor = snap()
  const local = structuredClone(ancestor)
  const remote = structuredClone(ancestor)
  local.workspaceData.settings.values.memoryConfig = { dailyNewWordTarget: 20 }
  remote.workspaceData.navigation.currentChapter = 3
  const result = await inspect(ancestor, local, remote)
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'both-devices-changed-requires-six-table-merge')
})
