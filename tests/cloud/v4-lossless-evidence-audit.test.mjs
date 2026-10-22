import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-v4-lossless-'))
const output = join(dir, 'audit.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v4-lossless-evidence-audit.ts')],
  outfile: output, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(dir, { recursive: true, force: true }))
const { auditV4LosslessEvidenceUnion: audit } =
  await import(pathToFileURL(output).href)
const names = ['wordRecords','chapterRecords','reviewRecords',
  'reviewWordStates','achievementEvents','achievementStates']
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const word = (id, token, w = 'apple') => ({
  id, attemptId: token, dict: 'school', word: w, chapter: 0,
  timeStamp: 1800000000 + id, wrongCount: 0, mistakes: {},
  timing: [], sourceMode: 'learn', learnItemKind: 'acquisition',
})
const session = (id, token) => ({
  id, sessionId: token, dict: 'school', index: 0, createTime: 1800000000,
  isFinished: false, sessionKind: 'review', words: [],
})
const snap = () => ({
  backupFormatVersion: 'qwerty-backup-v4',
  metadata: { createdAt: '2026-10-22T00:00:00Z',
    source: { kind: 'account', accountId: 'account-A' } },
  workspaceData: { database: { formatName: 'dexie', formatVersion: 1,
    data: { databaseName: 'RecordDB', databaseVersion: 6,
      tables: names.map(name => ({ name, schema: '++id' })),
      data: names.map(tableName => ({ tableName, inbound: true,
        rows: tableName === 'wordRecords' ? [word(1, uuid(1))] : [] })),
    } }, learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'school', currentChapter: 0 } },
})
const rows = (s, name) => s.workspaceData.database.data.data.find(
  x => x.tableName === name).rows
function fixture() {
  const ancestor = snap(), local = structuredClone(ancestor)
  const remote = structuredClone(ancestor), candidate = structuredClone(ancestor)
  rows(local, 'wordRecords').push(word(2, uuid(2), 'apple'))
  rows(remote, 'wordRecords').push(word(2, uuid(3), 'apple'))
  rows(candidate, 'wordRecords').push(word(2, uuid(2), 'apple'))
  rows(candidate, 'wordRecords').push({ ...word(2, uuid(3), 'apple'), id: 3 })
  rows(local, 'reviewRecords').push(session(1, uuid(10)))
  rows(remote, 'reviewRecords').push(session(1, uuid(11)))
  rows(candidate, 'reviewRecords').push(session(1, uuid(10)))
  rows(candidate, 'reviewRecords').push(session(2, uuid(11)))
  return { ancestor, local, remote, candidate }
}
test('two same-word independent attempts and sessions must survive numeric re-key', () => {
  const f = fixture(), before = structuredClone(f)
  const result = audit(f)
  assert.equal(result.status, 'verified', result.reason)
  assert.equal(result.uniqueAttempts, 3)
  assert.equal(result.sessionIds, 2)
  assert.equal(result.convergenceComplete, false)
  assert.deepEqual(f, before)
})
test('dropped one of two independent identical-timestamp attempts is detected', () => {
  const f = fixture()
  rows(f.candidate, 'wordRecords').pop()
  assert.equal(audit(f).reason,
    'lossless-missing-original-evidence:wordRecords')
})
test('invented attempt, repeated UUID and altered score are detected', () => {
  const cases = [
    f => rows(f.candidate, 'wordRecords').push(word(4, uuid(4))),
    f => rows(f.candidate, 'wordRecords')[2].attemptId = uuid(2),
    f => rows(f.candidate, 'wordRecords')[1].wrongCount = 999,
  ]
  for (const mutate of cases) {
    const f = fixture()
    mutate(f)
    assert.equal(audit(f).status, 'blocked')
  }
})
test('source device reusing same UUID with contradictory immutable data blocks', () => {
  const f = fixture()
  rows(f.remote, 'wordRecords')[1].attemptId = uuid(2)
  rows(f.remote, 'wordRecords')[1].word = 'cherry'
  assert.equal(audit(f).reason,
    'lossless-contradictory-immutable-uuid:wordRecords')
})
test('locally derived FSRS shadows may change without losing study evidence', () => {
  const f = fixture()
  rows(f.candidate, 'wordRecords')[1].fsrsShadow = {
    version: 1, sourceRecordId: 2,
  }
  assert.equal(audit(f).status, 'verified')
})
test('missing or forged ReviewSession UUID is blocked independently of word events', () => {
  const f = fixture()
  rows(f.candidate, 'reviewRecords').pop()
  assert.equal(audit(f).reason,
    'lossless-missing-original-evidence:reviewRecords')
  const g = fixture()
  rows(g.candidate, 'reviewRecords')[1].sessionId = uuid(99)
  assert.equal(audit(g).status, 'blocked')
})
test('legacy ancestor without UUID remains byte-for-byte immutable', () => {
  const f = fixture(), legacy = { ...word(9, uuid(9)), id: 9 }
  delete legacy.attemptId
  for (const s of Object.values(f)) rows(s, 'wordRecords').push(
    structuredClone(legacy))
  assert.equal(audit(f).status, 'verified')
  rows(f.candidate, 'wordRecords').at(-1).word = 'reinterpreted'
  assert.equal(audit(f).reason, 'lossless-rewritten-legacy:wordRecords')
  const missing = fixture()
  rows(missing.local, 'wordRecords').push(legacy)
  assert.equal(audit(missing).reason,
    'lossless-new-or-changed-legacy:wordRecords')
})
test('changed legacy session cursor is not silently adopted', () => {
  const f = fixture()
  const old = session(19)
  delete old.sessionId
  for (const s of Object.values(f)) rows(s, 'reviewRecords').push(
    structuredClone(old))
  rows(f.remote, 'reviewRecords').at(-1).index = 1
  assert.equal(audit(f).reason,
    'lossless-new-or-changed-legacy:reviewRecords')
})

test('account ownership of all four complete snapshots is required', () => {
  const f = fixture()
  f.remote.metadata.source.accountId = 'account-B'
  assert.equal(audit(f).reason,
    'lossless-cross-account-or-anonymous-snapshot')
  const g = fixture()
  g.candidate.metadata.source = { kind: 'anonymous' }
  assert.equal(audit(g).status, 'blocked')
})
