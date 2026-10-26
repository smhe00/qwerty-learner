import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir=mkdtempSync(join(tmpdir(),'qwerty-boot-state-'))
after(()=>rmSync(dir,{recursive:true,force:true}))
const clock=Date.now
afterEach(()=>{Date.now=clock})
const mocks={
 './auth':'export const loadAuth=()=>globalThis.__bootState.auth; export const setIsolatedAuthRetention=()=>{};',
 './workspace-vault':'export const workspaceRegistryPort={read:async()=>structuredClone(globalThis.__bootState.registry)};',
 './workspace-lock':'export const acquireWorkspaceWriterLease=async()=>({release(){globalThis.__bootState.releases++}});',
 './workspace-storage-witness':'export const assertWorkspaceMigrationWitness=()=>{if(globalThis.__bootState.badWitness)throw Error("bad witness")}; export const refreshWorkspaceMigrationWitness=()=>{}; export const installWorkspaceStorageWriterGuard=()=>{globalThis.__bootState.installed++};',
 './workspace-auth-transaction':'export const reconcileAuthTransition=async()=>"none";',
 './workspace-coordinator':'export const recoverPendingWorkspace=async()=>{throw Error("unexpected S1")};',
 './learning-sync-policy':'export const learningEventSyncEnabled=()=>true;',
 './v2-pull-journal':'export const syncV2PullJournalPort={read:async()=>globalThis.__bootState.pull};',
 './manual-v4-import-journal':'export const manualV4ImportJournalPort={read:async()=>null};',
 './m4-merge-journal':'export const m4MergeJournalPort={read:async()=>globalThis.__bootState.merge};',
 './v2-pull-recovery':'export const recoverPendingSyncV2Pull=()=>globalThis.__bootState.recover();',
 './manual-v4-import-recovery':'export const recoverPendingManualV4Import=async()=>{throw Error("unexpected import")};',
 './m4-merge-browser-recovery':'export const recoverPendingM4Merge=()=>globalThis.__bootState.recover();',
 './account-login-v4-check':'export const checkAccountV4AfterAuthentication=()=>globalThis.__bootState.v4();',
 './m4-witnessed-prefix-browser':'export const adoptWitnessedM3AtGuardedBoot=()=>globalThis.__bootState.m4();',
}
const file=join(dir,'boot.mjs')
await build({entryPoints:[resolve('src/sync/workspace-bootstrap.ts')],outfile:file,bundle:true,
 platform:'node',format:'esm',target:'node20',define:{'import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC':'"true"'},
 plugins:[{name:'boot-ports',setup(b){
  b.onResolve({filter:/^\.\//},x=>x.path in mocks?{path:x.path,namespace:'mock'}:undefined)
  b.onLoad({filter:/.*/,namespace:'mock'},x=>({contents:mocks[x.path]}))
 }}]})
const {prepareGuardedWorkspaceBoot:boot}=await import(pathToFileURL(file).href)
function setup(){
 const data=new Map()
 globalThis.sessionStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}
 globalThis.localStorage={getItem:k=>k==='qwerty.s1.workspace-migrated.v1'?'v2':null}
 globalThis.window={location:{pathname:'/',search:''},history:{replaceState(){}}}
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}})
 const s=globalThis.__bootState={
  now:1_800_000_000_000,auth:{token:'synthetic',expiresAt:9e9,user:{userId:'synthetic'}},
  registry:{generation:4,pending:null,active:{kind:'account',accountId:'synthetic'}},
  pull:null,merge:null,installed:0,releases:0,checks:0,adoptions:0,recoveries:0,
  async v4(){this.checks++;return {status:'noop',canContinue:true}},
  async m4(){this.adoptions++;return {status:'skipped'}},
  async recover(){this.recoveries++;this.pull=null;this.merge=null;return true},
 }
 Date.now=()=>s.now
 return s
}
test('expired successful preflight does not begin another M4 network chain',async()=>{
 const s=setup()
 s.v4=async()=>{s.checks++;s.now+=60001;return {status:'noop',canContinue:true}}
 const result=await boot();result.release()
 assert.equal(s.checks,1);assert.equal(s.adoptions,0);assert.equal(s.installed,1)
 assert.match(globalThis.sessionStorage.getItem('qwerty.s2.last-sync-result'),/已保存在本机/)
})
test('S2 stage, real boot recovery branch and next boot share one expired budget',async()=>{
 const s=setup()
 s.v4=async()=>{s.checks++;s.now+=45000;s.pull={accountId:'synthetic',registryGeneration:4};return {status:'pull-staged',canContinue:false}}
 s.recover=async()=>{s.recoveries++;s.now+=20000;s.pull=null;return true}
 await assert.rejects(boot(),/S2 Pull staged/)
 await assert.rejects(boot(),/S2 Pull recovery completed/)
 const result=await boot();result.release()
 assert.equal(s.checks,1);assert.equal(s.adoptions,0);assert.equal(s.recoveries,1);assert.equal(s.installed,1)
 const trace=JSON.parse(globalThis.sessionStorage.getItem('qwerty.startup-sync-trace.v1'))
 assert.equal(new Set(trace.map(x=>x.attemptId)).size,1)
 assert.equal(trace.at(-1).remainingMs,0)
})
test('M4 adoption does not restart the network budget on automatic reload',async()=>{
 const s=setup()
 s.m4=async()=>{s.adoptions++;s.now+=60001;return {status:'adopted'}}
 await assert.rejects(boot(),/M4 merge recovery completed/)
 const result=await boot();result.release()
 assert.equal(s.checks,1);assert.equal(s.adoptions,1);assert.equal(s.installed,1)
})
for(const fault of ['pending-pull','pending-merge','owner','token','witness']){
 test('network fallback cannot mount over '+fault,async()=>{
  const s=setup()
  s.v4=async()=>{
   if(fault==='pending-pull')s.pull={}
   if(fault==='pending-merge')s.merge={}
   if(fault==='owner')s.registry.generation++
   if(fault==='token')s.auth={...s.auth,token:'replacement'}
   if(fault==='witness')s.badWitness=true
   s.now+=60001
   return {status:'pending',canContinue:true}
  }
  await assert.rejects(boot(),/writes blocked|bad witness/)
  assert.equal(s.installed,0)
 })
}
test('failed recovery with expired deadline remains blocked and retains journal',async()=>{
 const s=setup();s.pull={accountId:'synthetic',registryGeneration:4}
 s.recover=async()=>{throw Error('restore interrupted')}
 await assert.rejects(boot(),/restore interrupted/)
 assert(s.pull);assert.equal(s.installed,0);assert.equal(s.checks,0)
})

test('trailing-slash Learn entry uses the same bounded boot policy', async () => {
  const s = setup()
  globalThis.window.location.pathname = '/learn/'
  s.v4 = async () => { s.checks++; s.now += 60001; return { status: 'noop', canContinue: true } }
  const result = await boot(); result.release()
  assert.equal(s.checks, 1)
  assert.equal(s.adoptions, 0)
  assert.equal(s.installed, 1)
})
