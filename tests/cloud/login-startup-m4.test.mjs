import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'qwerty-startup-m4-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const mocks = {
  './api': 'export const observeChainedLearningReceipts=()=>globalThis.__boot.observe();',
  './auth': 'export const loadAuth=()=>globalThis.__boot.auth;',
  './device-id': 'export const browserDeviceId=()=>"synthetic";',
  './m3-publication-browser':
    'export const etestM3PilotEnabled=()=>true; export const runEtestM3Publication=()=>globalThis.__boot.publish();',
  './m3-observed-chained-heads': 'export const selectObservedChainedHeads=()=>({status:"heads-observed-only",heads:[]});',
  './m3-witnessed-browser': 'export const inspectOwnedWitnessedHistory=(heads,options)=>globalThis.__boot.witness(options);',
  './workspace-vault': 'export const workspaceRegistryPort={read:async()=>globalThis.__boot.registry};',
  './m4-merge-journal': 'export const m4MergeJournalPort={};',
  './m4-merge-transaction': 'export const executeM4Merge=async()=>{throw Error("unexpected write")};',
  './m4-witnessed-prefix-candidate':
    'export const previewMonotonicWitnessedM4=async()=>{globalThis.__boot.calls.push("candidate");return {status:"blocked",reason:"m4-prefix-conflicting-local-attempt"}};',
  './workspace-storage-witness': 'export const refreshWorkspaceMigrationWitness=()=>{throw Error("unexpected seal")};',
  './workspace-v4-browser':
    'export const captureWorkingWorkspaceV4=async()=>{globalThis.__boot.calls.push("capture");return {}}; export const restoreWorkingWorkspaceV4=async()=>{throw Error("unexpected restore")}; export const materializeAuditedM4CandidateV4=async()=>{throw Error("unexpected materialize")};',
  '@/utils/db/core': 'export const db={wordRecords:{toCollection:()=>({raw:()=>({toArray:async()=>[]})})}};',
}
const output = join(dir, 'adapter.mjs')
await build({
  entryPoints: [resolve('src/sync/m4-witnessed-prefix-browser.ts')],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  plugins: [
    {
      name: 'io',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (x) => (x.path in mocks ? { path: x.path, namespace: 'mock' } : undefined))
        b.onLoad({ filter: /.*/, namespace: 'mock' }, (x) => ({ contents: mocks[x.path] }))
      },
    },
  ],
})
const { adoptWitnessedM3AtGuardedBoot: adopt } = await import(pathToFileURL(output).href)
function setup(
  results = [{ status: 'idle', scanned: 1 }],
  proof = {
    status: 'unchanged',
    reason: 'verified-prefix-already-local',
    publishReady: false,
    convergenceComplete: false,
    remoteAttemptCount: 1,
  },
) {
  const storage = new Map()
  globalThis.sessionStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }
  globalThis.window = { location: { pathname: '/learn', search: '' } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
  const state = (globalThis.__boot = {
    calls: [],
    registry: { generation: 1, pending: null, active: { kind: 'account', accountId: 'synthetic' } },
    auth: { user: { userId: 'synthetic' }, token: 'synthetic', expiresAt: 9e9 },
    publish: async () => {
      state.calls.push('publish')
      return results.shift()
    },
    observe: async () => {
      state.calls.push('observe')
      return { observedCount: 1 }
    },
    witness: async (options) => {
      assert.equal(options.allowUnchanged, true)
      state.calls.push('witness')
      return proof
    },
  })
  return { state, storage }
}
test('unchanged witnessed history stops before full V4 capture or any restore', async () => {
  const { state, storage } = setup()
  assert.equal((await adopt(state.registry)).reason, 'verified-prefix-already-local')
  assert.deepEqual(state.calls, ['publish', 'observe', 'witness'])
  const perf = JSON.parse(storage.get('qwerty.perf-diagnostics.v1'))
  assert.deepEqual(
    perf.map((x) => x.stage),
    ['m3-publication', 'm4-observe', 'm4-witness'],
  )
  const diagnostic = JSON.parse(storage.get('qwerty.learning-sync-diagnostics.v1'))
  assert.equal(diagnostic.at(-1).code, 'verified-prefix-already-local')
})
test('publication uncertainty stops once without observation or replay', async () => {
  const { state } = setup([{ status: 'blocked', reason: 'outbox-readback-integrity-mismatch' }])
  assert.equal((await adopt(state.registry)).status, 'blocked')
  assert.deepEqual(state.calls, ['publish'])
})
test('only confirmed remaining work permits a bounded second publication cycle', async () => {
  const { state } = setup([
    { status: 'uploaded-events-only', remaining: 1, scanned: 65 },
    { status: 'uploaded-events-only', remaining: 0, scanned: 65 },
  ])
  await adopt(state.registry)
  assert.deepEqual(state.calls, ['publish', 'publish', 'observe', 'witness'])
})
test('different verified history retains full capture and original candidate rejection', async () => {
  const { state } = setup(undefined, {
    status: 'witnessed',
    reason: 'verified-prefix-only',
    publishReady: false,
    convergenceComplete: false,
    remoteAttemptCount: 1,
    remoteEvents: [],
  })
  assert.equal((await adopt(state.registry)).reason, 'M4-prefix-candidate:m4-prefix-conflicting-local-attempt')
  assert.deepEqual(state.calls, ['publish', 'observe', 'witness', 'capture', 'candidate'])
})
test('owner change after remote proof prevents no-change acknowledgement or writes', async () => {
  const { state } = setup()
  const witness = state.witness
  state.witness = async (options) => {
    const proof = await witness(options)
    state.auth = { ...state.auth, token: 'changed' }
    return proof
  }
  assert.equal((await adopt(state.registry)).status, 'blocked')
  assert.ok(!state.calls.includes('capture'))
})
