/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import {circleBlobClientsEnabled,createBlobClientFactory,withCircleBlobClients} from '../../cloud-functions/_shared/blob-clients.js'
import {profileCircleRequest,profileCircleStore} from '../../cloud-functions/_shared/circle/profile.js'

test('SDK reuse never caches values and isolates store/consistency/project/credentials',async()=>{
  let created=0;const values=new Map();let env={PAGES_PROJECT_ID:'p1',PAGES_BLOB_DEPLOY_CREDENTIAL:'secret1'}
  const factory=createBlobClientFactory(()=>{created++;return {async get(key){return values.get(key)}}},()=>env)
  const first=factory({name:'one',consistency:'strong'});assert.equal(first,factory({name:'one',consistency:'strong'}))
  values.set('key',1);assert.equal(await first.get('key'),1);values.set('key',2);assert.equal(await first.get('key'),2)
  assert.notEqual(first,factory({name:'two',consistency:'strong'}))
  assert.notEqual(first,factory({name:'one',consistency:'eventual'}))
  assert.notEqual(first,factory({name:'one',consistency:'strong',projectId:'p2'}))
  assert.notEqual(first,factory({name:'one',consistency:'strong',token:'different'}))
  env={...env,PAGES_BLOB_DEPLOY_CREDENTIAL:'rotated'};assert.notEqual(first,factory({name:'one',consistency:'strong'}))
  assert.equal(created,6)
  for(let i=0;i<20;i++)factory({name:'evict'+i})
  assert.notEqual(first,factory({name:'one',consistency:'strong'}))
})
test('cold initialization is single-flight; each undispatched call still executes its own operation',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve});const calls=[]
  const raw={async get(key){assert.equal(this,raw);calls.push(key);if(calls.length===1)await gate;return key}}
  const client=createBlobClientFactory(()=>raw,()=>({}))('one')
  const first=client.get('first'),second=client.get('second'),third=client.get('third')
  assert.deepEqual(calls,['first']);release()
  assert.deepEqual(await Promise.all([first,second,third]),['first','second','third'])
  assert.deepEqual(calls,['first','second','third'])
})
test('a rejected first mutation is never replayed and does not poison subsequent requests',async()=>{
  const failure=new Error('uncertain');let calls=0
  const client=createBlobClientFactory(()=>({async setJSON(){calls++;if(calls===1)throw failure;return 'next'}}),()=>({}))('one')
  const result=await Promise.allSettled([client.setJSON('a',{}),client.setJSON('b',{})])
  assert.ok(result.every(r=>r.status==='rejected'&&r.reason===failure));assert.equal(calls,1)
  assert.equal(await client.setJSON('c',{}),'next');assert.equal(calls,2)
})
test('profile scopes remain separate outside the reusable SDK client',async()=>{
  const shared=createBlobClientFactory(()=>({async get(key){return key}}),()=>({}))('one')
  const responses=await Promise.all(['identity.json','members/member.json'].map(key=>profileCircleRequest({env:{branch:'etest'},request:new Request('https://fixture.invalid/api/circle/v2/mine',{headers:{authorization:'Bearer fixture','x-qwerty-circle-timing':'1'}})},async()=>{
    await profileCircleStore(shared).get('accounts/'+key)
    return new Response('{}')
  })))
  for(const response of responses){const trace=JSON.parse(Buffer.from(response.headers.get('X-Qwerty-Circle-Timing'),'base64url'));assert.equal(trace.spans.length,1)}
})


test('transport reuse is scoped to Circle routes and never inherited by non-Circle requests',async()=>{
  const circle=new Request('https://fixture.invalid/api/circle/v2/mine'),other=new Request('https://fixture.invalid/api/auth/me')
  assert.equal(circleBlobClientsEnabled(),false)
  await Promise.all([withCircleBlobClients(circle,async()=>{
    await Promise.resolve();assert.equal(circleBlobClientsEnabled(),true)
    await withCircleBlobClients(other,async()=>{await Promise.resolve();assert.equal(circleBlobClientsEnabled(),false)})
    assert.equal(circleBlobClientsEnabled(),true)
  }),withCircleBlobClients(other,async()=>{await Promise.resolve();assert.equal(circleBlobClientsEnabled(),false)})])
  assert.equal(circleBlobClientsEnabled(),false)
})

test('startup read optimization is exact method/path scoped; learning writes and account operations stay unchanged', async () => {
  const enabled = [['GET','/sync/v2/meta'],['GET','/sync/events/v2/observed'],['POST','/sync/events/v2/verify-set']]
  const disabled = [['POST','/sync/v2/meta'],['GET','/sync/events/v2/verify-set'],['POST','/sync/events/v2'],
    ['GET','/sync/events/v2'],['POST','/sync/v2/binary/direct'],['GET','/sync/v2/meta/'],['GET','/sync/v2/meta/extra'],
    ['POST','/auth/login'],['GET','/auth/me'],['DELETE','/auth/account']]
  for (const [method,path] of enabled) await withCircleBlobClients(new Request('https://fixture.invalid/api'+path,{method}), async () => {
    assert.equal(circleBlobClientsEnabled(),true)
    for (const [otherMethod,otherPath] of disabled) await withCircleBlobClients(new Request('https://fixture.invalid/api'+otherPath,{method:otherMethod}), async () => {
      assert.equal(circleBlobClientsEnabled(),false)
    })
    assert.equal(circleBlobClientsEnabled(),true)
  })
  assert.equal(circleBlobClientsEnabled(),false)
})
