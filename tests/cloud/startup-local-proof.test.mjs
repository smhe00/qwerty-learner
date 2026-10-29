import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const temp = mkdtempSync(join(tmpdir(), 'startup-local-proof-'))
after(() => rmSync(temp, { recursive: true, force: true }))
const file = join(temp, 'proof.mjs')
await build({ stdin: { contents: `export * from './src/sync/startup-local-proof';
export * from './src/sync/startup-sync-v2'; export * from './src/sync/workspace-v4';
export { payloadV4 } from './src/sync/v2-manual-executor';`, resolveDir: process.cwd(), loader: 'ts' },
  outfile: file, bundle: true, platform: 'node', format: 'esm', target: 'node20' })
const { startupLocalDigest: digest, sealStartupLocalProof: seal, matchesStartupLocalProof: matches,
  executeStartupSyncV2: run, matchesStartupCloudBaseline: cloudMatches, workspaceFingerprintV4: fingerprint, payloadV4 } = await import(pathToFileURL(file).href)
const clone = value => structuredClone(value)
const accountId = 'synthetic-local-proof'
const names = ['wordRecords', 'chapterRecords', 'reviewRecords', 'reviewWordStates', 'achievementEvents', 'achievementStates']
function snapshot() {
  return { backupFormatVersion: 'qwerty-backup-v4', metadata: { source: { kind: 'account', accountId }, createdAt: 'synthetic' },
    workspaceData: { database: { formatName: 'dexie', data: {
      tables: names.map(name => ({ name, schema: '++id', rowCount: 1 })),
      data: names.map(tableName => ({ tableName, inbound: true, rows: [{ id: 1, value: 'original' }] })),
    } }, learnRuntime: { dailySessions: {} }, settings: { version: 1, values: {} },
    navigation: { currentDict: 'shanghai-zhongkao-2027', currentChapter: 0 } } }
}
async function fixture() {
  const local = snapshot(), hash = await fingerprint(local), bytes = await payloadV4(local)
  const state = { local, meta: { hasData: true, revision: 3, logicalFingerprint: hash,
    clientFormatVersion: 'qwerty-backup-v4', payloadSha256: bytes.checksum, sizeBytes: bytes.bytes.length, storageEncoding: 'binary' },
    baseline: { accountId, baseRevision: 3, logicalFingerprint: hash }, proof: null,
    captures: 0, gets: 0, puts: 0, stages: 0, guards: 0, writes: 0, cloud: null }
  const port = {
    accountId, registryGeneration: 4,
    async assertQuiescentOwner() { state.guards++ }, async flush() {},
    async capture() { state.captures++; return clone(state.local) },
    async readBaseline() { return clone(state.baseline) },
    async compareAndSwapBaseline(expected, next) { assert.deepEqual(expected, state.baseline); state.baseline = clone(next); state.writes++ },
    async getMeta() { state.gets++; return clone(state.meta) },
    async getSnapshot() { assert.ok(state.cloud); return clone(state.cloud) },
    async put(input) {
      state.puts++
      const { createHash } = await import('node:crypto')
      state.meta = { ...state.meta, revision: input.baseRevision + 1, logicalFingerprint: input.logicalFingerprint,
        payloadSha256: createHash('sha256').update(input.payloadBytes).digest('hex') }
      return clone(state.meta)
    },
    async saveSource() {},
    journal: { async read() { return null }, async stage() { state.stages++ } },
  }
  const cache = { async readDigest() { return digest(state.local.workspaceData) },
    async read() { return clone(state.proof) }, async save(value) { state.proof = clone(value) } }
  return { state, port, cache }
}

test('explicit audit seeds proof; unchanged startup uses metadata only with zero capture/transfer/baseline writes', async () => {
  const { state, port, cache } = await fixture()
  assert.deepEqual(await run(port, cache, { allowReuse: false }), { status: 'noop', revision: 3 })
  assert.equal(state.captures, 1); assert.ok(state.proof)
  for (let i = 0; i < 3; i++) assert.equal((await run(port, cache)).status, 'upload-deferred')
  assert.equal(state.gets, 4); assert.equal(state.captures, 1); assert.equal(state.puts, 0)
  assert.equal(state.writes, 1); assert.equal(state.stages, 0)
})

test('explicit/Block sync always audits, then refreshes the proof for the next startup', async () => {
  const { state, port, cache } = await fixture()
  await run(port, cache, { allowReuse: false })
  await run(port, cache, { allowReuse: false })
  assert.equal(state.captures, 2)
  state.local.workspaceData.navigation.currentChapter++
  assert.equal((await run(port, cache, { allowReuse: false })).status, 'pushed')
  assert.equal(state.captures, 3)
  assert.equal((await run(port, cache)).status, 'upload-deferred')
  assert.equal(state.captures, 3); assert.equal(state.puts, 1)
})

for (const tableName of names) test('same-count edit invalidates proof for ' + tableName, async () => {
  const { state, port, cache } = await fixture()
  await run(port, cache, { allowReuse: false })
  state.local.workspaceData.database.data.data.find(t => t.tableName === tableName).rows[0].value = 'changed'
  const baseline = clone(state.baseline), proof = clone(state.proof)
  for (let i = 0; i < 2; i++) assert.equal((await run(port, cache)).status, 'upload-deferred')
  assert.equal(state.captures, 1); assert.equal(state.puts, 0); assert.equal(state.stages, 0)
  assert.deepEqual(state.baseline, baseline); assert.deepEqual(state.proof, proof)
  assert.equal((await run(port, cache, { allowReuse: false })).status, 'pushed')
  assert.equal(state.baseline.baseRevision, 4)
  await run(port, cache)
  assert.equal(state.captures, 2); assert.equal(state.puts, 1)
})

for (const field of ['navigation', 'settings', 'daily-session']) test('non-table local change invalidates proof: ' + field, async () => {
  const { state, port, cache } = await fixture()
  await run(port, cache, { allowReuse: false })
  if (field === 'navigation') state.local.workspaceData.navigation.currentChapter++
    if (field === 'settings') state.local.workspaceData.settings.values.typingTransVisible = false
  // A raw-storage digest change is sufficient even if a malformed session
  // will subsequently be rejected by the complete snapshot validator.
  if (field === 'daily-session') cache.readDigest = () => digest({ data: state.local.workspaceData, daily: 'changed' })
  const outcome = await run(port, cache)
  assert.equal(outcome.status, 'upload-deferred'); assert.equal(state.captures, 1)
  assert.equal(state.puts, 0); assert.equal(state.writes, 1)
})

for (const fault of ['absent', 'corrupt', 'checksum', 'account', 'generation', 'baseline', 'format', 'proof-read', 'digest-read', 'unsupported']) {
  test('unusable proof never implies equality; unchanged cloud may defer: ' + fault, async () => {
    const { state, port, cache } = await fixture()
    await run(port, cache, { allowReuse: false })
    if (fault === 'absent') state.proof = null
    if (fault === 'corrupt') state.proof = 'broken'
    if (fault === 'checksum') state.proof.checksum = '0'.repeat(64)
    if (fault === 'account') state.proof.accountId = 'another'
    if (fault === 'generation') port.registryGeneration++
    if (fault === 'baseline') state.baseline = null
    if (fault === 'format') state.meta.clientFormatVersion = 'qwerty-backup-v3'
    if (fault === 'proof-read') cache.read = async () => { throw Error('IDB unavailable') }
    if (fault === 'digest-read') cache.readDigest = async () => { throw Error('IDB unavailable') }
    if (fault === 'unsupported') cache.readDigest = async () => null
    await run(port, cache)
    assert.equal(state.captures, ['baseline', 'format'].includes(fault) ? 2 : 1)
    assert.equal(state.puts, 0); assert.equal(state.writes, fault === 'baseline' ? 2 : 1)
    assert.equal(state.gets, 2, 'fallback does not duplicate initial metadata request')
  })
}

test('remote new content follows verified download and meta recheck before staging; no cache writes', async () => {
  const { state, port, cache } = await fixture()
  await run(port, cache, { allowReuse: false })
  const saved = clone(state.proof), remote = clone(state.local)
  remote.workspaceData.navigation.currentChapter = 8
  const bytes = await payloadV4(remote)
  state.meta = { ...state.meta, revision: 4, logicalFingerprint: await fingerprint(remote), payloadSha256: bytes.checksum, sizeBytes: bytes.bytes.length }
  state.cloud = { ...state.meta, payloadEncoding: 'binary', payloadBytes: bytes.bytes }
  assert.deepEqual(await run(port, cache), { status: 'pull-reload-required', revision: 4 })
  assert.equal(state.gets, 3); assert.equal(state.stages, 1); assert.equal(state.puts, 0)
  assert.deepEqual(state.proof, saved); assert.equal(state.baseline.baseRevision, 3)
})

test('unchanged cloud with changed revision is re-audited before rebasing', async () => {
  const { state, port, cache } = await fixture()
  await run(port, cache, { allowReuse: false })
  state.meta.revision++
  await run(port, cache)
  assert.equal(state.captures, 2); assert.equal(state.baseline.baseRevision, 4)
})

test('remote disappearance/regression never reuses proof or overwrites cloud', async () => {
  for (const missing of [false, true]) {
    const { state, port, cache } = await fixture()
    await run(port, cache, { allowReuse: false })
    state.meta.revision = missing ? 0 : 2
    if (missing) Object.assign(state.meta, { hasData: false, logicalFingerprint: null })
    assert.equal((await run(port, cache)).status, 'blocked')
    assert.equal(state.puts, 0); assert.equal(state.captures, 2)
  }
})

test('authentication/network failure never treats a saved proof as current and does not replay a request', async () => {
  const { state, port, cache } = await fixture()
  await run(port, cache, { allowReuse: false })
  port.getMeta = async () => { state.gets++; throw Error('session_revoked') }
  await assert.rejects(run(port, cache), /session_revoked/)
  assert.equal(state.gets, 2); assert.equal(state.captures, 1); assert.equal(state.puts, 0)
})

test('owner change during fresh metadata check prevents cached success', async () => {
  const { state, port, cache } = await fixture()
  await run(port, cache, { allowReuse: false })
  let changed = false
  port.getMeta = async () => { changed = true; return state.meta }
  port.assertQuiescentOwner = async () => { if (changed) throw Error('owner changed') }
  await assert.rejects(run(port, cache), /owner changed/)
  assert.equal(state.captures, 1)
})

test('cache persistence failure does not fail completed sync; content changing during full audit cannot seed cache', async () => {
  const first = await fixture()
  first.cache.save = async () => { throw Error('quota') }
  assert.equal((await run(first.port, first.cache, { allowReuse: false })).status, 'noop')
  assert.equal(first.state.proof, null)
  const second = await fixture()
  let reads = 0
  second.cache.readDigest = () => digest(++reads === 1 ? 'before' : 'after')
  assert.equal((await run(second.port, second.cache, { allowReuse: false })).status, 'noop')
  assert.equal(second.state.proof, null)
})

test('lossless digest distinguishes JSON collisions and rejects unsupported types/cycles', async () => {
  for (const [a, b] of [[0, -0], [NaN, null], [Infinity, null], [{ a: undefined }, {}],
    [Array(1), [undefined]], [new Date(0), '1970-01-01T00:00:00.000Z'], [[1], { 0: 1 }]]) {
    assert.notEqual(await digest(a), await digest(b))
    assert.ok(await digest(a)); assert.ok(await digest(b))
  }
  assert.equal(await digest({ b: 2, a: 1 }), await digest({ a: 1, b: 2 }))
  for (const value of [new Map(), new Set(), new Uint8Array(1), /x/, 1n]) assert.equal(await digest(value), null)
  const shared = {}; assert.ok(await digest([shared, shared]))
  assert.notEqual(await digest([shared, shared]), await digest([{}, {}]))
  const cyclic = {}; cyclic.self = cyclic; assert.equal(await digest(cyclic), null)
})

test('a checksum cannot make a mismatched revision or local state eligible', async () => {
  const { state, port, cache } = await fixture()
  const proof = await seal({ accountId, generation: 4, localDigest: await cache.readDigest(), revision: 2,
    logicalFingerprint: state.meta.logicalFingerprint })
  assert.equal(await matches({ proof, accountId, generation: port.registryGeneration,
    localDigest: await cache.readDigest(), baseline: state.baseline, remote: state.meta }), false)
})


test('shared review references have stable lossless digests; topology and aliased values remain significant', async () => {
  const shared = { name: 'historical', trans: ['中文'], date: new Date(0) }
  const original = { words: [shared, shared], nested: { same: shared } }
  const checksum = await digest(original)
  assert.ok(checksum)
  assert.equal(await digest(structuredClone(original)), checksum)
  assert.equal(await digest({ nested: { same: shared }, words: [shared, shared] }), checksum)
  const duplicated = structuredClone(original)
  duplicated.words[1] = structuredClone(shared)
  assert.notEqual(await digest(duplicated), checksum, 'equal JSON is not equal reference topology')
  const changed = structuredClone(original)
  changed.words[1].trans[0] = 'changed'
  assert.notEqual(await digest(changed), checksum, 'same-count alias edit invalidates evidence')
  const cycle = { words: [] }; cycle.words.push(cycle)
  assert.equal(await digest(cycle), null)
  assert.equal(await digest({ a: new Date(0), b: new Date(0) }) === await digest({ a: shared.date, b: shared.date }), false)
})



test('startup without a proof retains edits and cannot mint a false clean baseline', async () => {
  const { state, port, cache } = await fixture()
  const baseline = clone(state.baseline)
  state.local.workspaceData.navigation.currentChapter++
  assert.deepEqual(await run(port, cache), { status: 'upload-deferred', revision: 3 })
  assert.equal(state.captures, 0); assert.equal(state.puts, 0); assert.equal(state.stages, 0)
  assert.equal(state.writes, 0); assert.equal(state.proof, null)
  assert.deepEqual(state.baseline, baseline)
  assert.equal((await run(port, cache, { allowReuse: false })).status, 'pushed')
  assert.equal(state.puts, 1); assert.equal(state.baseline.baseRevision, 4)
})

test('cloud revision advancing after deferral still detects both-sided edits', async () => {
  const { state, port, cache } = await fixture()
  state.local.workspaceData.navigation.currentChapter++
  assert.equal((await run(port, cache)).status, 'upload-deferred')
  state.meta.revision++
  state.meta.logicalFingerprint = 'b'.repeat(64)
  const result = await run(port, cache)
  assert.equal(result.status, 'conflict')
  assert.equal(result.reason, 'concurrent-edits')
  assert.equal(state.captures, 1); assert.equal(state.puts, 0); assert.equal(state.writes, 0)
})


test('startup deferral requires exact account, revision, fingerprint and valid cloud metadata', async () => {
  const { state } = await fixture()
  assert.equal(cloudMatches(accountId, state.baseline, state.meta), true)
  for (const change of [
    { revision: 2 }, { revision: 4 }, { logicalFingerprint: 'b'.repeat(64) },
    { hasData: false }, { clientFormatVersion: 'qwerty-backup-v3' },
    { storageEncoding: 'base64' }, { payloadSha256: null },
  ]) assert.equal(cloudMatches(accountId, state.baseline, { ...state.meta, ...change }), false)
  assert.equal(cloudMatches(accountId, null, state.meta), false)
  assert.equal(cloudMatches('other-account', state.baseline, state.meta), false)
  assert.equal(cloudMatches(accountId, { ...state.baseline, baseRevision: 0 }, state.meta), false)
})

for (const edited of [false, true]) test('matching cloud baseline never reads or waits for local rows: edited=' + edited, async () => {
  const { state, port, cache } = await fixture()
  if (edited) state.local.workspaceData.navigation.currentChapter++
  let digestReads = 0, proofReads = 0
  cache.readDigest = () => { digestReads++; return new Promise(() => {}) }
  cache.read = () => { proofReads++; return new Promise(() => {}) }
  const baseline = clone(state.baseline)
  assert.deepEqual(await run(port, cache), { status: 'upload-deferred', revision: 3 })
  assert.equal(digestReads, 0); assert.equal(proofReads, 0)
  assert.equal(state.gets, 1); assert.equal(state.captures, 0); assert.equal(state.puts, 0)
  assert.equal(state.writes, 0); assert.equal(state.stages, 0)
  assert.deepEqual(state.baseline, baseline); assert.equal(state.proof, null)
})
