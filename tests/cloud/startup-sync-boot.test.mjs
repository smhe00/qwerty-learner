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
 './workspace-lock':'export const acquireWorkspaceWriterLease=async()=>{if(globalThis.__bootState.leaseError)throw globalThis.__bootState.leaseError;return {release(){globalThis.__bootState.releases++}}};',
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
await build({stdin:{contents: "export {prepareGuardedWorkspaceBoot,mountGuardedWorkspaceApp} from './src/sync/workspace-bootstrap.ts'; export {WorkspaceWriterOccupiedError,M4RecoveryRequiredError} from './src/sync/workspace-errors.ts'; export {beginAccountVisit,claimAccountVisit,finishPassiveAccountVisit,ACCOUNT_VISIT_KEY} from './src/sync/account-passive-return.ts'",resolveDir:process.cwd(),loader:'ts'},outfile:file,bundle:true,
 platform:'node',format:'esm',target:'node20',define:{'import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC':'"true"'},
 plugins:[{name:'boot-ports',setup(b){
  b.onResolve({filter:/^\.\//},x=>x.path in mocks?{path:x.path,namespace:'mock'}:undefined)
  b.onLoad({filter:/.*/,namespace:'mock'},x=>({contents:mocks[x.path]}))
 }}]})
const {prepareGuardedWorkspaceBoot:boot,mountGuardedWorkspaceApp,WorkspaceWriterOccupiedError,M4RecoveryRequiredError,beginAccountVisit,claimAccountVisit,finishPassiveAccountVisit,ACCOUNT_VISIT_KEY}=await import(pathToFileURL(file).href)
function ready(outcome) {
 assert.equal(outcome.kind, 'ready')
 return outcome.boot
}
async function expectReload(promise, reason) {
 const outcome = await promise
 assert.deepEqual(outcome, { kind: 'reload-required', reason })
}
async function expectBlocked(promise, pattern) {
 const outcome = await promise
 assert.equal(outcome.kind, 'blocked')
 assert.match(String(outcome.error), pattern)
}
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
 const result=ready(await boot());result.release()
 assert.equal(s.checks,1);assert.equal(s.adoptions,0);assert.equal(s.installed,1)
 assert.match(globalThis.sessionStorage.getItem('qwerty.s2.last-sync-result'),/已保存在本机/)
})
test('S2 stage, real boot recovery branch and next boot share one expired budget',async()=>{
 const s=setup()
 s.v4=async()=>{s.checks++;s.now+=45000;s.pull={accountId:'synthetic',registryGeneration:4};return {status:'pull-staged',canContinue:false}}
 s.recover=async()=>{s.recoveries++;s.now+=20000;s.pull=null;return true}
 await expectReload(boot(),'s2-pull-staged')
 await expectReload(boot(),'s2-pull-recovered')
 const result=ready(await boot());result.release()
 assert.equal(s.checks,1);assert.equal(s.adoptions,0);assert.equal(s.recoveries,1);assert.equal(s.installed,1)
 const trace=JSON.parse(globalThis.sessionStorage.getItem('qwerty.startup-sync-trace.v1'))
 assert.equal(new Set(trace.map(x=>x.attemptId)).size,1)
 assert.equal(trace.at(-1).remainingMs,0)
})
test('M4 adoption does not restart the network budget on automatic reload',async()=>{
 const s=setup()
 s.m4=async()=>{s.adoptions++;s.now+=60001;return {status:'adopted'}}
 await expectReload(boot(),'m4-recovered')
 const result=ready(await boot());result.release()
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
  await expectBlocked(boot(),/writes blocked|bad witness/)
  assert.equal(s.installed,0)
 })
}
test('failed recovery with expired deadline remains blocked and retains journal',async()=>{
 const s=setup();s.pull={accountId:'synthetic',registryGeneration:4}
 s.recover=async()=>{throw Error('restore interrupted')}
 await expectBlocked(boot(),/restore interrupted/)
 assert(s.pull);assert.equal(s.installed,0);assert.equal(s.checks,0)
})

test('trailing-slash Learn entry uses the same bounded boot policy', async () => {
  const s = setup()
  globalThis.window.location.pathname = '/learn/'
  s.v4 = async () => { s.checks++; s.now += 60001; return { status: 'noop', canContinue: true } }
  const result = ready(await boot()); result.release()
  assert.equal(s.checks, 1)
  assert.equal(s.adoptions, 0)
  assert.equal(s.installed, 1)
})

async function passiveReturn(s, mobile=false) {
 globalThis.window.location={pathname:mobile?'/mobile':'/',search:''}
 const first=ready(await boot());first.release()
 beginAccountVisit(mobile)
 globalThis.window.location={pathname:mobile?'/mobile/account':'/',search:mobile?'':'?s1-account=manage'}
 const account=ready(await boot());account.release()
 const visit=claimAccountVisit(s.registry,mobile)
 finishPassiveAccountVisit(visit,s.registry)
 globalThis.window.location={pathname:mobile?'/mobile':'/',search:''}
 s.checks=0;s.adoptions=0
 return visit
}
for(const mobile of [false,true])test('passive '+(mobile?'phone':'PC')+' return skips network once, then reload resumes sync',async()=>{
 const s=setup();assert(await passiveReturn(s,mobile))
 const result=ready(await boot());result.release()
 assert.equal(result.passiveAccountReturn,true)
 assert.equal(s.checks,0);assert.equal(s.adoptions,0)
 assert.equal(globalThis.sessionStorage.getItem(ACCOUNT_VISIT_KEY),null)
 const again=ready(await boot());again.release()
 assert.equal(again.passiveAccountReturn,false)
 assert.equal(s.checks,1);assert.equal(s.adoptions,1)
})
for(const pending of ['pull','merge','manual','switch'])test('passive ticket never suppresses '+pending+' journal recovery or subsequent sync',async()=>{
 const s=setup();await passiveReturn(s)
 if(pending==='switch')s.registry.pending={from:s.registry.active,to:s.registry.active,transactionId:4}
 else s[pending]={accountId:'synthetic',registryGeneration:4}
 await expectReload(boot(),{pull:'s2-pull-recovered',merge:'m4-recovered',manual:'manual-v4-recovered',switch:'s1-recovered'}[pending])
 assert.equal(s.recoveries,1);assert.equal(s.checks,0)
 assert.equal(globalThis.sessionStorage.getItem(ACCOUNT_VISIT_KEY),null)
 const resumed=ready(await boot());resumed.release()
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
 const result=ready(await boot());result.release()
 assert.equal(result.passiveAccountReturn,false);assert.equal(s.checks,1)
})
test('unconfirmed startup cannot mint a passive visit that conceals the next recovery check',async()=>{
 const s=setup();s.v4=async()=>{s.checks++;return {status:'pending',canContinue:true}}
 assert.equal(await passiveReturn(s),null)
 const result=ready(await boot());result.release();assert.equal(s.checks,1)
})
test('passive return still rejects a new journal found in the final ownership check',async()=>{
 const s=setup();await passiveReturn(s)
 let reads=0;s.afterRead=()=>{if(++reads===2)s.merge={}}
 await expectBlocked(boot(),/durable recovery remains pending/)
 assert.equal(s.checks,0);assert.equal(s.adoptions,0)
})
test('passive return never bypasses missing writer integrity or wrong account',async()=>{
 const s=setup();await passiveReturn(s);s.badWitness=true
 await expectBlocked(boot(),/bad witness/)
 assert.equal(s.checks,0)
})

for (const pending of ['pull', 'merge', 'manual', 'switch']) test('explicit '+pending+' recovery outcome releases once without mounting', async () => {
 const s = setup(), stages = []
 if (pending === 'switch') s.registry.pending = { from:s.registry.active, to:s.registry.active, transactionId:4 }
 else s[pending] = { accountId:'synthetic', registryGeneration:4 }
 let mounts = 0
 const outcome = await mountGuardedWorkspaceApp(() => { mounts++ }, stage => stages.push(stage))
 assert.deepEqual(outcome, { kind:'reload-required', reason:{pull:'s2-pull-recovered',merge:'m4-recovered',manual:'manual-v4-recovered',switch:'s1-recovered'}[pending] })
 assert.equal(mounts, 0); assert.equal(s.installed, 0); assert.equal(s.releases, 1)
 assert.equal(stages.at(-1), 'restart-required'); assert.equal(s.recoveries, 1)
})

test('occupied is a typed lease signal even if diagnostic wording changes', async () => {
 const s = setup(), error = new WorkspaceWriterOccupiedError()
 error.message = 'translated contention detail'
 s.leaseError = error
 let mounts = 0
 const outcome = await mountGuardedWorkspaceApp(() => { mounts++ })
 assert.deepEqual(outcome, { kind:'occupied', error })
 assert.equal(mounts, 0); assert.equal(s.releases, 0); assert.equal(s.installed, 0)
})

for (const message of ['Another tab owns the active workspace writer lease', 'S2 Pull staged; reload required', 'M4 merge recovery completed; reload required']) {
 test('ordinary error text cannot authorize a startup action: '+message, async () => {
  const s = setup(), error = new Error(message)
  s.afterRead = () => { throw error }
  let mounts = 0
  const outcome = await mountGuardedWorkspaceApp(() => { mounts++ })
  assert.deepEqual(outcome, { kind:'blocked', reason:'safety-check', error })
  assert.equal(mounts, 0); assert.equal(s.releases, 1); assert.equal(s.installed, 0)
 })
}

test('staged M4 interruption retains journal and cause without automatic success/replay', async () => {
 const s = setup(), stages = [], cause = new Error('write interrupted'), error = new M4RecoveryRequiredError(cause)
 error.message = 'translated recovery detail'
 s.m4 = async () => { s.adoptions++; s.merge = { accountId:'synthetic', registryGeneration:4 }; throw error }
 const outcome = await mountGuardedWorkspaceApp(() => assert.fail('must not mount'), stage => stages.push(stage))
 assert.deepEqual(outcome, { kind:'blocked', reason:'m4-recovery-required', error })
 assert.equal(outcome.error.cause, cause); assert.ok(s.merge)
 assert.equal(s.releases, 1); assert.equal(s.adoptions, 1); assert.equal(s.recoveries, 0); assert.equal(s.installed, 0)
 assert.equal(stages.at(-1), 'restart-required')
})

test('unknown M4 failure cannot mount over the journal it left behind', async () => {
 const s = setup()
 s.m4 = async () => { s.merge = {}; throw new Error('network failure') }
 const outcome = await mountGuardedWorkspaceApp(() => assert.fail('must not mount'))
 assert.equal(outcome.kind, 'blocked'); assert.equal(outcome.reason, 'safety-check')
 assert.ok(s.merge); assert.equal(s.releases, 1); assert.equal(s.installed, 0)
})

test('mount failure cannot impersonate a completed recovery and releases the ready lease once', async () => {
 const s = setup(), error = new Error('S1 recovery completed; reload required')
 let mounts = 0
 const outcome = await mountGuardedWorkspaceApp(() => { mounts++; throw error })
 assert.deepEqual(outcome, { kind:'blocked', reason:'safety-check', error })
 assert.equal(mounts, 1); assert.equal(s.releases, 1)
})

test('ready transfers the live lease; throwing stage observers cannot release or bypass it', async () => {
 const s = setup()
 let mounts = 0
 const outcome = await mountGuardedWorkspaceApp(() => { mounts++ }, () => { throw new Error('observer') })
 const value = ready(outcome)
 assert.equal(value.mode, 'isolated'); assert.equal(mounts, 1); assert.equal(s.releases, 0)
 value.release(); assert.equal(s.releases, 1)
})
