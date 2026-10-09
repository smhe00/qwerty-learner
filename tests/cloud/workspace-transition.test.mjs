import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const dir = mkdtempSync(join(tmpdir(), 'qwerty-workspace-test-'))
const target = join(dir, 'workspace.mjs')
const root = fileURLToPath(new URL('../../', import.meta.url))
await build({
  entryPoints: [resolve(root, 'src/sync/workspace-transition.ts')],
  outfile: target, bundle: true, platform: 'node', format: 'esm', target: 'node20',
})
after(() => rmSync(dir, { recursive: true, force: true }))
const { ANONYMOUS, initialRegistry, keyOf, switchWorkspace, recoverWorkspace } =
  await import(pathToFileURL(target).href)
const a = { kind: 'account', accountId: 'immutable-A' }
const b = { kind: 'account', accountId: 'immutable-B' }

function fixture() {
  let metadata = structuredClone(initialRegistry())
  let working = 'anonymous-progress'
  const vault = new Map([[keyOf(a), 'saved-A']])
  let crash = ''
  let restores = 0
  const phases = []
  const port = {
    async read() { return structuredClone(metadata) },
    async compareAndSwap(expected, next) {
      assert.equal(metadata.generation, expected)
      if (crash === 'commit' && next.pending === null && metadata.pending) {
        crash = ''
        throw new Error('commit crash')
      }
      metadata = structuredClone(next)
    },
  }
  const replica = {
    async flush() { if (crash === 'flush') throw Error('flush crash') },
    async saveSource(source) {
      if (crash === 'save') throw Error('save crash')
      vault.set(keyOf(source), working)
    },
    async restoreTarget(workspace) {
      restores++
      if (crash === 'restore') {
        crash = ''
        working = 'partial data'
        throw Error('restore crash')
      }
      working = vault.get(keyOf(workspace)) ?? ''
    },
  }
  return {
    port, replica, vault, phases,
    get metadata() { return metadata },
    get working() { return working },
    get restores() { return restores },
    set working(value) { working = value },
    set crash(value) { crash = value },
  }
}
test('immutable identities cannot overlap with anonymous', () => {
  assert.notEqual(keyOf(a), keyOf(b))
  assert.notEqual(keyOf(a), keyOf(ANONYMOUS))
  assert.throws(() => keyOf({ kind: 'account', accountId: '' }))
})
test('source save and durable journal precede target restoration', async () => {
  const f = fixture()
  await switchWorkspace(f.port, f.replica, a, x => f.phases.push(x))
  assert.deepEqual(f.phases, ['saving', 'prepared', 'restoring', 'complete'])
  assert.equal(f.metadata.generation, 2)
  assert.equal(f.metadata.pending, null)
  assert.deepEqual(f.metadata.active, a)
  assert.equal(f.working, 'saved-A')
  assert.equal(f.vault.get('anonymous'), 'anonymous-progress')
})
test('account A -> B direct switching is prohibited', async () => {
  const f = fixture()
  await switchWorkspace(f.port, f.replica, a)
  await assert.rejects(switchWorkspace(f.port, f.replica, b), /explicit anonymous logout/)
  assert.deepEqual(f.metadata.active, a)
})
test('failure before journal cannot change ownership', async () => {
  const f = fixture()
  f.crash = 'save'
  await assert.rejects(switchWorkspace(f.port, f.replica, a), /save crash/)
  assert.deepEqual(f.metadata, initialRegistry())
  assert.equal(f.working, 'anonymous-progress')
})
test('crash during restore preserves pending journal and recovery replays', async () => {
  const f = fixture()
  f.crash = 'restore'
  await assert.rejects(switchWorkspace(f.port, f.replica, a), /recover before enabling/)
  assert.equal(f.working, 'partial data')
  assert.ok(f.metadata.pending)
  await assert.rejects(switchWorkspace(f.port, f.replica, b), /requires recovery/)
  await recoverWorkspace(f.port, f.replica)
  assert.equal(f.metadata.pending, null)
  assert.deepEqual(f.metadata.active, a)
  assert.equal(f.working, 'saved-A')
  const count = f.restores
  await recoverWorkspace(f.port, f.replica)
  assert.equal(f.restores, count)
})
test('crash after target restore but before final CAS is idempotent', async () => {
  const f = fixture()
  f.crash = 'commit'
  await assert.rejects(switchWorkspace(f.port, f.replica, a), /recover before enabling/)
  assert.ok(f.metadata.pending)
  await recoverWorkspace(f.port, f.replica)
  assert.deepEqual(f.metadata.active, a)
  assert.equal(f.working, 'saved-A')
})
test('logout saves account changes and recovers old anonymous workspace', async () => {
  const f = fixture()
  await switchWorkspace(f.port, f.replica, a)
  f.working = 'new-A'
  await switchWorkspace(f.port, f.replica, ANONYMOUS)
  assert.equal(f.vault.get(keyOf(a)), 'new-A')
  assert.equal(f.working, 'anonymous-progress')
})
test('generation CAS failure does not invoke target restore', async () => {
  const f = fixture()
  f.port.compareAndSwap = async () => { throw Error('stale tab') }
  await assert.rejects(switchWorkspace(f.port, f.replica, a), /stale tab/)
  assert.equal(f.restores, 0)
})
test('UI progress callback may throw without corrupting state', async () => {
  const f = fixture()
  await switchWorkspace(f.port, f.replica, a, () => { throw Error('unmounted') })
  assert.deepEqual(f.metadata.active, a)
})


test('S1 exhaustive bounded switch crash windows preserve isolated owners', async () => {
  for (const boundary of ['flush', 'save', 'prepare-cas', 'restore', 'commit']) {
    const f = fixture()
    if (boundary === 'prepare-cas') {
      const original = f.port.compareAndSwap
      f.port.compareAndSwap = async (expected, next) => {
        if (next.pending) throw new Error('prepare CAS crash')
        return original(expected, next)
      }
    } else {
      f.crash = boundary
    }
    await assert.rejects(switchWorkspace(f.port, f.replica, a))
    if (boundary === 'flush' || boundary === 'save' || boundary === 'prepare-cas') {
      assert.equal(f.metadata.pending, null, boundary)
      assert.deepEqual(f.metadata.active, ANONYMOUS, boundary)
      assert.equal(f.working, 'anonymous-progress', boundary)
      assert.equal(f.metadata.generation, 0, boundary)
    } else {
      assert.ok(f.metadata.pending, boundary)
      assert.deepEqual(f.metadata.active, ANONYMOUS, boundary)
      f.crash = ''
      await recoverWorkspace(f.port, f.replica)
      assert.equal(f.metadata.pending, null, boundary)
      assert.deepEqual(f.metadata.active, a, boundary)
      assert.equal(f.working, 'saved-A', boundary)
      assert.equal(f.vault.get('anonymous'), 'anonymous-progress', boundary)
    }
  }
})

test('S0.5 identity trace projection holds only at S1 quiescent commit points', async () => {
  const f = fixture()
  const physical = []
  const observe = (event) => {
    physical.push({
      phase: event,
      active: keyOf(f.metadata.active),
      pending: f.metadata.pending !== null,
    })
  }
  await switchWorkspace(f.port, f.replica, a, observe)
  f.working = 'A-progress'
  await switchWorkspace(f.port, f.replica, ANONYMOUS, observe)
  await switchWorkspace(f.port, f.replica, b, observe)

  // The canonical CloudSyncV2.tla Login/CommitLogout actions are atomic.
  // S1's saving/prepared/restoring are unobservable stuttering steps behind
  // the single-writer boot gate; only 'complete' projects to account change.
  const committed = physical.filter(step => step.phase === 'complete')
  assert.deepEqual(committed.map(step => step.active), [
    keyOf(a), keyOf(ANONYMOUS), keyOf(b),
  ])
  assert.ok(committed.every(step => !step.pending))
  assert.deepEqual(physical.filter(step => step.phase === 'prepared')
    .map(step => step.active), [
    keyOf(ANONYMOUS), keyOf(a), keyOf(ANONYMOUS),
  ])
  assert.ok(physical.filter(step => step.phase === 'prepared')
    .every(step => step.pending))
  assert.equal(f.vault.get(keyOf(a)), 'A-progress')
  assert.equal(f.vault.get(keyOf(ANONYMOUS)), 'anonymous-progress')
  assert.equal(f.working, '')
})
