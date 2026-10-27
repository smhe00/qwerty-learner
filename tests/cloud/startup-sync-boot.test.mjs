import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir=mkdtempSync(join(tmpdir(),'qwerty-boot-state-'))
after(()=>rmSync(dir,{recursive:true,force:true}))
const clock=Date.now
afterEach(()=>{Date.now=clock})
const mocks={
 './auth':'export const loadAuth=()=>globalThis.__bootState.auth; export const setIsolatedAuthRetention=()=>{};',
 './workspace-vault':'export const workspaceRegistryPort={read:async()=>{globalThis.__bootState.afterRead?.();return structuredClone(globalThis.__bootState.registry)}};',
 './workspace-lock':'export const acquireWorkspaceWriterLease=async()=>({release(){globalThis.__bootState.releases++}});',
 './workspace-storage-witness':'export const assertWorkspaceMigrationWitness=()=>{if(globalThis.__bootState.badWitness)throw Error("bad witness")}; export const refreshWorkspaceMigrationWitness=()=>{}; export const installWorkspaceStorageWriterGuard=()=>{globalThis.__bootState.installed++};',
 './workspace-auth-transaction':'export const reconcileAuthTransition=async()=>globalThis.__bootState.reconciliation;',
 './workspace-coordinator':'export const recoverPendingWorkspace=async()=>{globalThis.__bootState.registry.pending=null;globalThis.__bootState.recoveries++};',
 './learning-sync-policy':'export const learningEventSyncEnabled=()=>true;',
 './v2-pull-journal':'export const syncV2PullJournalPort={read:async()=>globalThis.__bootState.pull};',
 './manual-v4-import-journal':'export const manualV4ImportJournalPort={read:async()=>globalThis.__bootState.manual};',
 './m4-merge-journal':'export const m4MergeJournalPort={read:async()=>globalThis.__bootState.merge};',
 './v2-pull-recovery':'export const recoverPendingSyncV2Pull=()=>globalThis.__bootState.recover();',
 './manual-v4-import-recovery':'export const recoverPendingManualV4Import=async()=>{globalThis.__bootState.manual=null;globalThis.__bootState.recoveries++};',
 './m4-merge-browser-recovery':'export const recoverPendingM4Merge=()=>globalThis.__bootState.recover();',
 './account-login-v4-check':'export const checkAccountV4AfterAuthentication=()=>globalThis.__bootState.v4();',
 './m4-witnessed-prefix-browser':'export const adoptWitnessedM3AtGuardedBoot=()=>globalThis.__bootState.m4();',
}
const file=join(dir,'boot.mjs')
await build({stdin:{contents: "export {prepareGuardedWorkspaceBoot} from './src/sync/workspace-bootstrap.ts'; export {beginAccountVisit,claimAccountVisit,finishPassiveAccountVisit,ACCOUNT_VISIT_KEY} from './src/sync/account-passive-return.ts'",resolveDir:process.cwd(),loader:'ts'},outfile:file,bundle:true,
 platform:'node',format:'esm',target:'node20',define:{'import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC':'"true"'},
 plugins:[{name:'boot-ports',setup(b){
  b.onResolve({filter:/^\.\//},x=>x.path in mocks?{path:x.path,namespace:'mock'}:undefined)
  b.onLoad({filter:/.*/,namespace:'mock'},x=>({contents:mocks[x.path]}))
 }}]})
const {prepareGuardedWorkspaceBoot:boot,beginAccountVisit,claimAccountVisit,finishPassiveAccountVisit,ACCOUNT_VISIT_KEY}=await import(pathToFileURL(file).href)
function setup(){
 const data=new Map()
 globalThis.sessionStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}
 const stored=new Map([['qwerty.s1.workspace-migrated.v1','v2:0123456789abcdef']])
 globalThis.localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)}
 globalThis.window={location:{pathname:'/',search:''},history:{replaceState(){}}}
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}})
 const s=globalThis.__bootState={
  now:1_800_000_000_000,auth:{token:'synthetic',expiresAt:9e9,user:{userId:'synthetic'}},
  registry:{generation:4,pending:null,active:{kind:'account',accountId:'synthetic'}},
  pull:null,merge:null,manual:null,reconciliation:"none",installed:0,releases:0,checks:0,adoptions:0,recoveries:0,
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
 assert.match(globalThis.sessionStorage.getItem('qwerty.s2.last-sync-result'),/完整学习数据已同步。多设备历史验证尚未完成/)
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

async function passiveReturn(s, mobile=false) {
 globalThis.window.location={pathname:mobile?'/mobile':'/',search:''}
 const first=await boot();first.release()
 beginAccountVisit(mobile)
 globalThis.window.location={pathname:mobile?'/mobile/account':'/',search:mobile?'':'?s1-account=manage'}
 const account=await boot();account.release()
 const visit=claimAccountVisit(s.registry,mobile)
 finishPassiveAccountVisit(visit,s.registry)
 globalThis.window.location={pathname:mobile?'/mobile':'/',search:''}
 s.checks=0;s.adoptions=0
 return visit
}
for(const mobile of [false,true])test('passive '+(mobile?'phone':'PC')+' return skips network once, then reload resumes sync',async()=>{
 const s=setup();assert(await passiveReturn(s,mobile))
 const result=await boot();result.release()
 assert.equal(result.passiveAccountReturn,true)
 assert.equal(s.checks,0);assert.equal(s.adoptions,0)
 assert.equal(globalThis.sessionStorage.getItem(ACCOUNT_VISIT_KEY),null)
 const again=await boot();again.release()
 assert.equal(again.passiveAccountReturn,false)
 assert.equal(s.checks,1);assert.equal(s.adoptions,1)
})
for(const pending of ['pull','merge','manual','switch'])test('passive ticket never suppresses '+pending+' journal recovery or subsequent sync',async()=>{
 const s=setup();await passiveReturn(s)
 if(pending==='switch')s.registry.pending={from:s.registry.active,to:s.registry.active,transactionId:4}
 else s[pending]={accountId:'synthetic',registryGeneration:4}
 await assert.rejects(boot(),/recovery completed/)
 assert.equal(s.recoveries,1);assert.equal(s.checks,0)
 assert.equal(globalThis.sessionStorage.getItem(ACCOUNT_VISIT_KEY),null)
 const resumed=await boot();resumed.release()
 assert.equal(resumed.passiveAccountReturn,false);assert.equal(s.checks,1)
})
for(const change of ['expired','clock-back','generation','witness','quick-sync','auth-intent','malformed','wrong-route'])test('passive ticket rejected after '+change,async()=>{
 const s=setup();await passiveReturn(s)
 if(change==='expired')s.now+=300001
 if(change==='clock-back')s.now--
 if(change==='generation')s.registry.generation++
 if(change==='witness')globalThis.localStorage.setItem('qwerty.s1.workspace-migrated.v1','v2:fedcba9876543210')
 if(change==='quick-sync')globalThis.sessionStorage.setItem('qwerty.s2.quick-sync.intent.v1','{}')
 if(change==='auth-intent'){globalThis.localStorage.setItem('qwerty.s1.auth-transition.v1','{}');s.reconciliation='completed'}
 if(change==='malformed')globalThis.sessionStorage.setItem(ACCOUNT_VISIT_KEY,'{')
 if(change==='wrong-route')globalThis.window.location.pathname='/learn'
 const result=await boot();result.release()
 assert.equal(result.passiveAccountReturn,false);assert.equal(s.checks,1)
})
test('unconfirmed startup cannot mint a passive visit that conceals the next recovery check',async()=>{
 const s=setup();s.v4=async()=>{s.checks++;return {status:'pending',canContinue:true}}
 assert.equal(await passiveReturn(s),null)
 const result=await boot();result.release();assert.equal(s.checks,1)
})
test('passive return still rejects a new journal found in the final ownership check',async()=>{
 const s=setup();await passiveReturn(s)
 let reads=0;s.afterRead=()=>{if(++reads===2)s.merge={}}
 await assert.rejects(boot(),/durable recovery remains pending/)
 assert.equal(s.checks,0);assert.equal(s.adoptions,0)
})
test('passive return never bypasses missing writer integrity or wrong account',async()=>{
 const s=setup();await passiveReturn(s);s.badWitness=true
 await assert.rejects(boot(),/bad witness/)
 assert.equal(s.checks,0)
})


test('partial history reports its own progress after V4 success and cannot authorize adoption', async()=>{
 const s=setup(), stages=[]
 s.m4=async()=>{s.adoptions++;return {status:'pending',reason:'verification-in-progress',completed:16,total:40}}
 const result=await boot(stage=>stages.push(stage));result.release()
 assert.equal(s.installed,1);assert.equal(s.recoveries,0)
 assert.ok(stages.includes('verifying-history'))
 assert.match(sessionStorage.getItem('qwerty.s2.last-sync-result'),/完整学习数据已同步。历史验证已完成 16\/40 批/)
})
test('partial history cannot disguise an unconfirmed full snapshot as synchronized', async()=>{
 const s=setup()
 s.v4=async()=>({status:'pending',canContinue:true,detail:'pending'})
 s.m4=async()=>({status:'pending',reason:'verification-download-pending',completed:16,total:40})
 const result=await boot();result.release()
 assert.match(sessionStorage.getItem('qwerty.s2.last-sync-result'),/完整学习数据同步尚未确认/)
 assert.match(sessionStorage.getItem('qwerty.s2.last-sync-result'),/历史记录读取已完成 16\/40 批/)
 assert.equal(s.recoveries,0)
})


test('completed exact history clears an interrupted old history notice but preserves unrelated recovery results', async()=>{
 const s=setup()
 s.m4=async()=>({status:'skipped',reason:'verified-prefix-already-local'})
 sessionStorage.setItem('qwerty.s2.last-sync-result','完整学习数据已同步。历史验证已完成 16/40 批，下次同步将接着处理，可以继续学习。')
 ;(await boot()).release()
 assert.equal(sessionStorage.getItem('qwerty.s2.last-sync-result'),null)
 sessionStorage.setItem('qwerty.s2.last-sync-result','已完成云端学习数据安全恢复。')
 ;(await boot()).release()
 assert.equal(sessionStorage.getItem('qwerty.s2.last-sync-result'),'已完成云端学习数据安全恢复。')
})
