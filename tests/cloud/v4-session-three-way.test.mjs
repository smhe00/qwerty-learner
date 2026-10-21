import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-session-3way-'))
const compiled = join(tmp, 'three-way.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v4-session-three-way.ts')],
  outfile: compiled, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(tmp, { recursive: true, force: true }))
const { inspectThreeWayReviewSessions: project,
  digestThreeWayReviewSessionAncestor: digest } =
  await import(pathToFileURL(compiled).href)

const UUID = (id) => '00000000-0000-4000-8000-' + String(id).padStart(12, '0')
const session = (id = 1) => ({
  sessionId: UUID(id), id, dict: 'school', index: 0, createTime: 1800000000,
  isFinished: false, words: [{ name: 'hello', trans: ['hi'] },
    { name: 'world', trans: ['earth'] }], sessionKind: 'review',
})
const inspect = async (ancestor, local, remote) => project({
  ancestor, pinnedAncestorDigest: await digest(ancestor), local, remote,
})

test('canonical ancestor digest ignores local numeric IDs and row order', async () => {
  const a = [session(1), session(2)]
  const b = a.map((s, i) => ({ ...s, id: i + 20 })).reverse()
  assert.equal(await digest(a), await digest(b))
  assert.notEqual(await digest(a), await digest([a[0]]))
})

test('requires independently pinned ancestor digest and rejects altered baseline', async () => {
  const base = [session()]
  assert.equal((await project({ ancestor: base, local: base, remote: base,
    pinnedAncestorDigest: '0'.repeat(64) })).reason, 'ancestor-digest-mismatch')
  assert.equal((await project({ ancestor: base, local: base, remote: base,
    pinnedAncestorDigest: 'untrusted' })).reason, 'unverified-ancestor-digest')
})

test('one side progresses, other stays at ancestor: read-only fast-forward candidate', async () => {
  const base = [session()]
  const local = structuredClone(base)
  local[0].index = 1
  local[0].id = 101
  const remote = structuredClone(base)
  remote[0].id = 9
  const before = structuredClone({ base, local, remote })
  const out = await inspect(base, local, remote)
  assert.equal(out.status, 'projected', out.reason)
  assert.equal(out.counts.localAdvance, 1)
  assert.equal(out.sessions[0].record.index, 1)
  assert.equal(out.sessions[0].record.id, undefined)
  assert.equal(out.sessions[0].selectedFrom, 'local')
  assert.equal(out.publishReady, false)
  assert.equal(out.convergenceComplete, false)
  assert.deepEqual({ base, local, remote }, before)
})

test('reverse fast-forward and identical two-sided changes are deterministic', async () => {
  const base = [session()]
  const next = structuredClone(base)
  next[0].index = 1
  assert.equal((await inspect(base, base, next)).counts.remoteAdvance, 1)
  const both = await inspect(base, next, next)
  assert.equal(both.status, 'projected', both.reason)
  assert.equal(both.counts.identicalAdvance, 1)
})

test('two independently advanced cursors cannot be merged by max(index)', async () => {
  const base = [session()]
  const a = structuredClone(base)
  const b = structuredClone(base)
  a[0].index = 1
  b[0].index = 2
  assert.equal((await inspect(base, a, b)).reason,
    'concurrent-session-advance-conflict')
  b[0].index = 1
  b[0].itemStates = { hello: { answer: 'different' } }
  assert.equal((await inspect(base, a, b)).reason,
    'concurrent-session-advance-conflict')
})

test('new disjoint sessions are retained, same UUID created twice must match', async () => {
  const base = []
  const local = [session(1)]
  const remote = [session(2)]
  const result = await inspect(base, local, remote)
  assert.equal(result.status, 'projected')
  assert.equal(result.counts.localNew, 1)
  assert.equal(result.counts.remoteNew, 1)
  assert.deepEqual(result.sessions.map(s => s.sessionId), [UUID(1), UUID(2)])
  assert.equal((await inspect(base, local, [{ ...local[0], id: 9 }]))
    .counts.identicalNew, 1)
  assert.equal((await inspect(base, local, [{
    ...local[0], id: 9, index: 1,
  }])).reason, 'concurrent-new-session-conflict')
})

test('ancestor missing from either side blocks: absence is not a deletion', async () => {
  const base = [session()]
  assert.equal((await inspect(base, [], base)).reason,
    'ancestral-session-missing-on-device')
  assert.equal((await inspect(base, base, [])).reason,
    'ancestral-session-missing-on-device')
})

test('session header mutation, terminal mutation, cursor regression block', async () => {
  const base = [session()]
  const changed = structuredClone(base)
  changed[0].createTime += 1
  assert.equal((await inspect(base, changed, base)).reason,
    'session-immutable-header-changed')
  changed[0] = { ...base[0], index: 1, isFinished: true, words: [] }
  const after = await inspect(base, changed, base)
  assert.equal(after.status, 'projected', after.reason)
  const completed = structuredClone(changed)
  completed[0].isFinished = false
  completed[0].words = base[0].words
  assert.equal((await inspect(changed, completed, changed)).reason,
    'terminal-session-mutated')
  const baseProgress = structuredClone(base)
  baseProgress[0].index = 1
  assert.equal((await inspect(baseProgress, base, baseProgress)).reason,
    'session-cursor-regression')
})

test('legacy sessions, duplicate identities and origin numeric-ID collisions fail closed', async () => {
  const left = [session()]
  const legacy = [structuredClone(left[0])]
  delete legacy[0].sessionId
  assert.equal((await inspect([], legacy, left)).reason,
    'invalid-or-legacy-session')
  const copied = [{ ...left[0], id: 2 }, left[0]]
  assert.equal((await inspect([], copied, [])).reason,
    'invalid-or-legacy-session')
  const colliding = [session(1), { ...session(2), id: 1 }]
  assert.equal((await inspect([], colliding, [])).reason,
    'invalid-or-legacy-session')
})

test('candidate snapshots are deeply detached from original device records', async () => {
  const a = [session()]
  const result = await inspect([], a, [])
  assert.equal(result.status, 'projected')
  result.sessions[0].record.words[0].name = 'mutated'
  assert.equal(a[0].words[0].name, 'hello')
})
