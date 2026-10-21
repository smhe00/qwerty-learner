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
test('same-word modifications cannot generate a candidate for journal admission',async () => {
  const base=snap(),local=structuredClone(base),remote=structuredClone(base)
  words(local).push(word('banana',2,2))
  words(remote).push(word('banana',2,3))
  const result=await preview({accountId,pinnedAncestorFingerprint:await hash(base),
    ancestor:base,local,remote})
  assert.equal(result.status,'blocked')
  assert.equal(result.candidate,undefined)
})
