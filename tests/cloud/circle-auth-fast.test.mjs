/* eslint-env node */
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import {createBackendService} from '../../cloud-functions/_shared/core.js'
import {createEdgeOneBlobStorage} from '../../cloud-functions/_shared/storage/edgeone-blob.js'
import {createIdleAccounts} from '../../cloud-functions/_shared/idle-accounts.js'
function fixture(){
  const objects=new Map(),calls=[];const hooks={}
  const store={async get(key){calls.push(key);if(hooks.read)await hooks.read(key);return structuredClone(objects.get(key)??null)},async list({prefix}){calls.push(prefix);if(hooks.read)await hooks.read(prefix);return {blobs:[...objects.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))}},async setJSON(key,value){objects.set(key,structuredClone(value));await hooks.set?.(key)},async delete(key){objects.delete(key)}}
  const storage=createEdgeOneBlobStorage(store),idle=createIdleAccounts({store,startAt:'2026-01-01',requestScopedActivity:true})
  const backend=createBackendService({storage,parallelAuthReads:true,activityGuard:identity=>idle.touch(identity)})
  return {objects,calls,hooks,store,storage,idle,backend}
}
test('parallel auth is fresh per call across login, password change and token revocation',async()=>{
  const f=fixture();const first=await f.backend.register('circle_fast_fixture','fixture-password','first')
  assert.equal((await f.backend.me(first.token)).user.userId,first.user.userId)
  const second=await f.backend.login('circle_fast_fixture','fixture-password','second')
  await assert.rejects(f.backend.me(first.token),{code:'session_revoked'})
  const third=await f.backend.changePassword(second.token,'fixture-password','replacement-password','third')
  await assert.rejects(f.backend.me(second.token),{code:'session_revoked'})
  assert.equal((await f.backend.me(third.token)).user.userId,first.user.userId)
  await f.storage.revokeSessionToken(third.token.split('.')[1],createHash('sha256').update(third.token).digest('hex'))
  await assert.rejects(f.backend.me(third.token),{code:'session_revoked'})
})
test('independent strong auth reads start concurrently, but error precedence remains fail-closed',async()=>{
  const f=fixture(),auth=await f.backend.register('parallel_fixture','fixture-password','one')
  let release,started=0,ready;const entered=new Promise(resolve=>{ready=resolve}),gate=new Promise(resolve=>{release=resolve})
  f.hooks.read=async key=>{if(key.startsWith('accounts/')){started++;if(started===4)ready();await gate}}
  const me=f.backend.me(auth.token)
  const timer=setTimeout(()=>{release();ready()},1500)
  await entered;assert.equal(started,4,'four independent auth reads start before either resolves');release();clearTimeout(timer)
  assert.equal((await me).user.userId,auth.user.userId);f.hooks.read=undefined
  const real=f.storage.getAccount;f.storage.getAccount=async()=>null;f.storage.getLatestAuth=async()=>{throw Error('later storage failure')}
  await assert.rejects(f.backend.me(auth.token),{code:'invalid_token'});f.storage.getAccount=real
})
test('request-local daily reuse always checks live cleanup fences and rechecks after new writes',async()=>{
  const f=fixture(),auth=await f.backend.register('cleanup_fixture','fixture-password','one')
  const root='maintenance/idle/v1/'+auth.user.userId+'/'
  f.calls.length=0;await f.backend.me(auth.token)
  assert.equal(f.calls.filter(k=>k.startsWith(root+'days/')).length,0,'registration already touched this request-local day')
  assert.equal(f.calls.filter(k=>k===root+'fence.json').length,1)
  f.objects.set(root+'fence.json',{phase:'draining'})
  await assert.rejects(f.backend.me(auth.token),{code:'account_cleanup_pending'})
  f.objects.delete(root+'fence.json');f.calls.length=0
  const freshIdle=createIdleAccounts({store:f.store,startAt:'2026-01-01',requestScopedActivity:true})
  const identity=await f.storage.getAccount(auth.token.split('.')[1]);await freshIdle.touch(identity)
  assert.equal(f.calls.filter(k=>k.startsWith(root+'days/')).length,1,'new request has no daily cache')
  const day=[...f.objects.keys()].find(k=>k.startsWith(root+'days/'));f.objects.delete(day)
  const nextIdle=createIdleAccounts({store:f.store,startAt:'2026-01-01',requestScopedActivity:true})
  f.hooks.set=async key=>{if(key.startsWith(root+'days/'))f.objects.set(root+'fence.json',{phase:'draining'})}
  await assert.rejects(nextIdle.touch(identity),{code:'account_cleanup_pending'})
})
