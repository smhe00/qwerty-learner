import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir=mkdtempSync(join(tmpdir(),'qwerty-checkout-defer-'))
after(()=>rmSync(dir,{recursive:true,force:true}))
const deviceId='qwerty-web-00000000-0000-4000-8000-000000000010'
const mocks={
 './auth':'export const loadAuth=()=>globalThis.__checkout.auth;',
 './device-id':'export const browserDeviceId=()=>globalThis.__checkout.deviceId;',
 './workspace-vault':'export const workspaceRegistryPort={read:async()=>globalThis.__checkout.registry};',
 './learning-sync-policy':'export const learningEventSyncEnabled=()=>true;',
 './startup-sync-budget':'export const startupSyncBudgetActive=()=>globalThis.__checkout.preMount;',
 './multi-device-recovery-browser':'export const recoverOwnedLearningEvents=async()=>({scanned:1,pending:1});',
 './multi-device-outbox-transport':'export const flushOneWitnessedOutboxBatch=async()=>({status:"verified",remaining:0});',
 './multi-device-outbox-idb':'export const inspectEventOutbox=async()=>globalThis.__checkout.outbox;',
 './m2-checkout-declaration-browser':'export const declareOwnedEtestCheckout=()=>globalThis.__checkout.declare();',
}
const file=join(dir,'publisher.mjs')
await build({entryPoints:[resolve('src/sync/m3-publication-browser.ts')],outfile:file,bundle:true,platform:'node',format:'esm',target:'node20',
 plugins:[{name:'ports',setup(b){
  b.onResolve({filter:/^\.\//},x=>x.path in mocks?{path:x.path,namespace:'mock'}:undefined)
  b.onLoad({filter:/.*/,namespace:'mock'},x=>({contents:mocks[x.path]}))
 }}]})
const {runEtestM3Publication:publish,flushDeferredM3Checkout:flush}=await import(pathToFileURL(file).href)
function setup(){
 const head={deviceId,sequence:1,batchId:'00000000-0000-4000-8000-000000000011',sha256:'a'.repeat(64)}
 globalThis.sessionStorage={getItem:()=>null,setItem(){}}
 return globalThis.__checkout={
  preMount:true,deviceId,auth:{token:'synthetic',expiresAt:9e9,user:{userId:'owner'}},
  registry:{generation:4,pending:null,active:{kind:'account',accountId:'owner'}},
  outbox:{version:1,accountId:'owner',deviceId,pending:[],inflight:null,confirmedHead:head},
  calls:0,async declare(){this.calls++;return {status:'blocked',reason:'optional',publishReady:false,convergenceComplete:false}},
 }
}
test('pre-mount publication completes before optional checkout; explicit post-mount flush drains it',async()=>{
 const s=setup()
 let release
 s.declare=()=>{s.calls++;return new Promise(resolve=>{release=resolve})}
 const result=await publish()
 assert.equal(result.status,'uploaded-events-only');assert.equal(s.calls,0)
 let finished=false
 const pending=flush().then(()=>{finished=true})
 await new Promise(resolve=>setTimeout(resolve,5))
 assert.equal(s.calls,1);assert.equal(finished,false)
 release({status:'blocked',reason:'network-failure',publishReady:false,convergenceComplete:false})
 await pending
 assert.equal(finished,true)
 await flush();assert.equal(s.calls,1)
})
test('deferred checkout cannot write after token changed before mount',async()=>{
 const s=setup()
 await publish()
 s.auth={...s.auth,token:'new-token'}
 await flush()
 assert.equal(s.calls,0)
})
test('mounted background publication keeps existing declaration behavior',async()=>{
 const s=setup();s.preMount=false
 assert.equal((await publish()).status,'uploaded-events-only')
 assert.equal(s.calls,1)
})
