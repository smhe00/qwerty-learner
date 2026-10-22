import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-disjoint-m4-'))
await Promise.all([
  ['candidate', 'src/sync/v4-disjoint-word-candidate.ts'],
  ['adoption', 'src/sync/m4-cloud-adoption.ts'],
  ['m4', 'src/sync/m4-merge-transaction.ts'],
  ['v4', 'src/sync/workspace-v4.ts'],
].map(([out, entry]) => build({
  entryPoints: [resolve(root, entry)], outfile: join(dir,out+'.mjs'),
  bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root,'tsconfig.json'),
})))
after(() => rmSync(dir, { recursive: true, force: true }))
const { previewDisjointWordV4: preview } =
  await import(pathToFileURL(join(dir,'candidate.mjs')).href)
const { inspectM4CloudAdoption: inspectAdoption } =
  await import(pathToFileURL(join(dir,'adoption.mjs')).href)
const { executeM4Merge: apply, recoverM4Merge: recover } =
  await import(pathToFileURL(join(dir,'m4.mjs')).href)
const { workspaceFingerprintV4: hash } =
  await import(pathToFileURL(join(dir,'v4.mjs')).href)
const accountId = 'm4-disjoint-account'
const attempt = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0')
const word = (name, id, n) => ({
  id, dict:'shanghai', word:name, attemptId:attempt(n),
  timeStamp:1800000000 + n, chapter:0, timing:[],
  wrongCount:0, mistakes:{}, sourceMode:'learn',
  learnItemKind:'acquisition',
})
function snap() {
  const tableNames = ['wordRecords','chapterRecords','reviewRecords',
    'reviewWordStates','achievementEvents','achievementStates']
  return { backupFormatVersion:'qwerty-backup-v4',
    metadata:{ createdAt:'2026-10-22T00:00:00Z',
      source:{kind:'account',accountId}},
    workspaceData:{
      database:{formatName:'dexie',formatVersion:1,data:{
        databaseName:'RecordDB',databaseVersion:6,
        tables:tableNames.map(name=>({name,schema:'++id'})),
        data:tableNames.map(tableName=>({tableName,inbound:true,
          rows:tableName==='wordRecords'?[word('apple',1,1)]:[]}))
      }},
      learnRuntime:{dailySessions:{}},
      settings:{version:1,values:{}},
      navigation:{currentDict:'shanghai',currentChapter:0},
    },
  }
}
function words(s) {
  return s.workspaceData.database.data.data.find(
    t=>t.tableName==='wordRecords').rows
}
function replica(initial, opts = {}) {
  const state = {snapshot:structuredClone(initial),pending:null,closed:false,
    phases:[], rollback:[] }
  const journal = {
    async read(){return structuredClone(state.pending)},
    async stage(pending) {
      if (state.pending) throw Error('pending busy')
      state.pending=structuredClone(pending)
      state.phases.push('stage')
    },
    async finalize(pending, decision) {
      assert.equal(pending.candidateFingerprint,state.pending.candidateFingerprint)
      state.rollback.push(structuredClone(pending.original))
      state.pending=null
      state.phases.push('finish-'+decision)
    },
  }
  const device = {
    async capture(id) {assert.equal(id,accountId);return structuredClone(state.snapshot)},
    async restore(next,id) {
      assert.equal(id,accountId)
      state.snapshot=structuredClone(next)
      state.phases.push('restore')
      if (opts.crashRestore && !state.closed) {
        state.closed=true
        throw Error('simulated crash')
      }
    },
    async seal(){state.phases.push('seal')},
  }
  return {state,journal,device}
}
test('two independently learned words can enter full-V4 M4 journal, verify and retain immutable undo', async () => {
  const base=snap(),local=structuredClone(base),remote=structuredClone(base)
  words(local).push(word('banana',2,2))
  words(remote).push(word('cherry',2,3))
  const result=await preview({accountId,pinnedAncestorFingerprint:await hash(base),
    ancestor:base,local,remote})
  assert.equal(result.status,'projected',result.reason)
  assert.equal(result.publishReady,false)
  const f=replica(local)
  const original=await hash(local)
  await apply(f.journal,f.device,{accountId,registryGeneration:2,
    expectedOriginalFingerprint:original,candidate:result.candidate})
  assert.deepEqual(new Set(words(f.state.snapshot).map(x=>x.word)),
    new Set(['apple','banana','cherry']))
  assert.equal(await hash(f.state.snapshot),result.candidateFingerprint)
  assert.equal(await hash(f.state.rollback[0]),original)
  assert.equal(f.state.pending,null)
  assert.equal(await recover(f.journal,f.device,'apply'),false)
})
test('crash during M4 restore keeps whole snapshot and restores original via explicit rollback', async () => {
  const base=snap(),local=structuredClone(base),remote=structuredClone(base)
  words(local).push(word('banana',2,2))
  words(remote).push(word('cherry',2,3))
  const result=await preview({accountId,pinnedAncestorFingerprint:await hash(base),
    ancestor:base,local,remote})
  assert.equal(result.status,'projected',result.reason)
  const f=replica(local,{crashRestore:true})
  await assert.rejects(apply(f.journal,f.device,{
    accountId,registryGeneration:2,
    expectedOriginalFingerprint:await hash(local),candidate:result.candidate,
  }),/m4-merge-interrupted-recovery-required/)
  assert.ok(f.state.pending,'both full snapshots remain in journal')
  assert.equal(await recover(f.journal,f.device,'rollback'),true)
  assert.equal(await hash(f.state.snapshot),await hash(local))
  assert.equal(f.state.pending,null)
})
test('same-word independent attempts yield candidate but require separate journal/cloud admission',async () => {
  const base=snap(),local=structuredClone(base),remote=structuredClone(base)
  words(local).push(word('banana',2,2))
  words(remote).push(word('banana',2,3))
  const result=await preview({accountId,pinnedAncestorFingerprint:await hash(base),
    ancestor:base,local,remote})
  assert.equal(result.status,'projected',result.reason)
  assert.equal(result.chronologicallyReplayedWords,1)
  assert.equal(result.publishReady,false)
  assert.equal(result.convergenceComplete,false)
  assert.equal(words(result.candidate).length,3)
  assert.equal(result.candidateFingerprint,await hash(result.candidate))
})


const pinOf = async (snapshot, revision = 3) => ({
  status:'pinned-local-s2-pull-only', accountId, revision,
  fingerprint:await hash(snapshot), snapshot,
  publishReady:false, convergenceComplete:false,
})

test('M4 cloud adoption accepts authenticated ancestor fast-forward only if local unchanged',async()=>{
  const base=snap(),remote=structuredClone(base)
  words(remote).push(word('banana',2,2))
  const result=await inspectAdoption({accountId,pin:await pinOf(base),
    local:structuredClone(base),verifiedCloud:remote,
    cloudRevision:4,cloudFingerprint:await hash(remote)})
  assert.equal(result.status,'verified-candidate',result.reason)
  assert.equal(result.reason,'remote-fast-forward')
  assert.equal(result.admissionReady,true)
  assert.equal(result.convergenceComplete,false)
  assert.equal(result.candidateFingerprint,await hash(remote))
})

test('M4 cloud adoption accepts proven complete local overlap after remote CAS merge',async()=>{
  const base=snap(),local=structuredClone(base),remote=structuredClone(base)
  words(local).push(word('banana',2,2))
  words(remote).push(word('cherry',2,3))
  const merged=await preview({accountId,pinnedAncestorFingerprint:await hash(base),
    ancestor:base,local,remote})
  assert.equal(merged.status,'projected',merged.reason)
  const decision=await inspectAdoption({accountId,pin:await pinOf(base),
    local,verifiedCloud:merged.candidate,cloudRevision:4,
    cloudFingerprint:merged.candidateFingerprint})
  assert.equal(decision.status,'verified-candidate',decision.reason)
  assert.equal(decision.reason,'cloud-already-contains-local-merge')
  assert.equal(decision.candidateFingerprint,merged.candidateFingerprint)
  const f=replica(local)
  await apply(f.journal,f.device,{accountId,registryGeneration:2,
    expectedOriginalFingerprint:decision.originalFingerprint,
    candidate:decision.candidate})
  assert.deepEqual(new Set(words(f.state.snapshot).map(x=>x.word)),
    new Set(['apple','banana','cherry']))
  assert.equal(await hash(f.state.rollback[0]),await hash(local),
    'pre-adoption original must survive the M4 immutable rollback')
})

test('M4 cloud adoption blocks cloud missing a local independent attempt',async()=>{
  const base=snap(),local=structuredClone(base),remote=structuredClone(base)
  words(local).push(word('banana',2,2))
  words(remote).push(word('cherry',2,3))
  const decision=await inspectAdoption({accountId,pin:await pinOf(base),
    local,verifiedCloud:remote,cloudRevision:5,
    cloudFingerprint:await hash(remote)})
  assert.equal(decision.status,'blocked')
  assert.equal(decision.admissionReady,false)
  assert.equal(decision.reason,'m4-adoption-cloud-missing-local-merge')
})

test('M4 cloud adoption requires exact pin ownership, digest and higher revision',async()=>{
  const base=snap(),remote=structuredClone(base)
  words(remote).push(word('banana',2,2))
  const pin=await pinOf(base)
  const common={accountId,local:structuredClone(base),
    verifiedCloud:remote,cloudRevision:4,cloudFingerprint:await hash(remote)}
  for(const props of [
    {pin:null}, {pin:{...pin,accountId:'foreign'}},
    {pin:{...pin,fingerprint:'0'.repeat(64)}},
    {cloudRevision:3},{cloudFingerprint:'0'.repeat(64)},
    {accountId:'foreign'},
  ]){
    const verdict=await inspectAdoption({...common,pin,...props})
    assert.equal(verdict.status,'blocked')
    assert.equal(verdict.admissionReady,false)
  }
})
