import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const tmp=mkdtempSync(join(tmpdir(),'qwerty-boot-budget-'))
after(()=>rmSync(tmp,{recursive:true,force:true}))
const file=join(tmp,'budget.mjs')
await build({
  stdin:{contents:"export * from './src/sync/startup-sync-budget'; export {getSyncV2Meta,getSyncV2SnapshotBinary} from './src/sync/api';",resolveDir:resolve('.'),loader:'ts'},
  outfile:file,bundle:true,platform:'node',format:'esm',target:'node20',
  define:{REACT_APP_DEPLOY_ENV:'"edgeone"','import.meta.env.VITE_QWERTY_SYNC_DISABLED':'"false"','import.meta.env.VITE_QWERTY_SYNC_BASE_URL':'""'},
  plugins:[{name:'idle-readonly',setup(b){b.onResolve({filter:/idle-maintenance-trigger$/},()=>({path:'idle',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const noteCloudActivity=()=>{};'}))}}],
})
const b=await import(pathToFileURL(file).href)
const owner={accountId:'synthetic',generation:4}
function storage(){
  const data=new Map()
  return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}
}
const originalFetch=globalThis.fetch
afterEach(()=>{b.finishStartupSyncBudget();globalThis.fetch=originalFetch})
test('slow successful operations share remaining budget across two recovery documents',()=>{
  const s=storage();let now=100000
  let budget=b.createStartupSyncBudget(owner,s,()=>now)
  const id=budget.evidence().attemptId
  now+=22000;budget.continueAfterReload();budget.finish()
  budget=b.createStartupSyncBudget(owner,s,()=>now)
  assert.equal(budget.evidence().attemptId,id)
  assert.equal(budget.remainingMs(),38000)
  now+=22000;budget.continueAfterReload();budget.finish()
  budget=b.createStartupSyncBudget(owner,s,()=>now)
  assert.equal(budget.remainingMs(),16000)
  now+=22000
  assert.equal(budget.remainingMs(),0)
  assert.equal(budget.evidence().reloads,2)
})
test('finished boot clears continuation; explicit new attempt gets a new budget',()=>{
  const s=storage();let now=100000
  let budget=b.createStartupSyncBudget(owner,s,()=>now)
  now+=65000;budget.finish()
  budget=b.createStartupSyncBudget(owner,s,()=>now)
  assert.equal(budget.remainingMs(),60000)
})
test('different owner/generation never inherits another account continuation',()=>{
  const s=storage();let now=100000
  let budget=b.createStartupSyncBudget(owner,s,()=>now)
  now+=65000;budget.continueAfterReload();budget.finish()
  budget=b.createStartupSyncBudget({...owner,generation:5},s,()=>now)
  assert.equal(budget.remainingMs(),60000)
})
for(const value of ['damaged',JSON.stringify({...owner,version:1,deadline:1e15})]){
  test('damaged continuation cannot grant extra network time: '+value.slice(0,10),()=>{
    const s=storage();s.setItem(b.STARTUP_SYNC_BUDGET_KEY,value)
    assert.equal(b.createStartupSyncBudget(owner,s,()=>100000).remainingMs(),0)
  })
}
test('clock rollback cannot prolong current boot',()=>{
  const s=storage();let now=100000
  const budget=b.createStartupSyncBudget(owner,s,()=>now)
  now-=1000;assert.equal(budget.remainingMs(),0)
})
function beginWithRemaining(ms){
  globalThis.sessionStorage=storage()
  globalThis.window={location:{href:'http://localhost/',hostname:'localhost'}}
  const now=Date.now()
  globalThis.sessionStorage.setItem(b.STARTUP_SYNC_BUDGET_KEY,JSON.stringify({...owner,version:1,
    attemptId:'00000000-0000-4000-8000-000000000001',startedAt:now-60000+ms,deadline:now+ms,reloads:2}))
  b.beginStartupSyncBudget(owner)
}
test('actual API aborts and settles stalled metadata at remaining deadline',async()=>{
  beginWithRemaining(500)
  let aborted=false,calls=0
  globalThis.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>{
    calls++
    signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('aborted','AbortError'))},{once:true})
  })
  await assert.rejects(b.getSyncV2Meta('synthetic'),{name:'AbortError'})
  assert.equal(aborted,true);assert.equal(calls,1);assert.equal(b.startupSyncTimeRemaining(),false)
  await assert.rejects(b.getSyncV2Meta('synthetic'),/budget-exhausted/)
  assert.equal(calls,1)
})
test('offline transport fails once without retry or artificial success',async()=>{
  beginWithRemaining(1000);let calls=0
  globalThis.fetch=async()=>{calls++;throw new TypeError('offline')}
  await assert.rejects(b.getSyncV2Meta('synthetic'),/offline/)
  assert.equal(calls,1)
})
test('response body is also covered by shared deadline',async()=>{
  beginWithRemaining(500)
  let bodyAborted=false
  globalThis.fetch=async(_url,{signal})=>({status:200,text:()=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>{bodyAborted=true;reject(new DOMException('aborted','AbortError'))},{once:true})
  })})
  await assert.rejects(b.getSyncV2Meta('synthetic'),{name:'AbortError'})
  assert.equal(bodyAborted,true)
})

test('binary manifest and part share the remaining deadline, including streamed part body', async () => {
  beginWithRemaining(500)
  let calls = 0, bodyAborted = false
  globalThis.fetch = async (_url, { signal }) => {
    calls++
    if (calls === 1) return { status: 200, ok: true, text: async () => JSON.stringify({
      hasData: true, payloadEncoding: 'binary', payloadSha256: 'a'.repeat(64),
      count: 1, chunkBytes: 512 * 1024, sizeBytes: 1, partSha256s: ['a'.repeat(64)], revision: 1,
    }) }
    return { status: 200, ok: true, arrayBuffer: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { bodyAborted = true; reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    }) }
  }
  await assert.rejects(b.getSyncV2SnapshotBinary('synthetic'), { name: 'AbortError' })
  assert.equal(calls, 2)
  assert.equal(bodyAborted, true)
})
