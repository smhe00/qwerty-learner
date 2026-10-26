/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import {profileCircleRequest,profileCircleStore,timeCircleStage} from '../../cloud-functions/_shared/circle/profile.js'
const request = (branch='etest',header='1',token='Bearer profile-fixture',path='/api/circle/v2/mine') => ({env:{branch},request:new Request('https://fixture.invalid'+path,{headers:{'x-qwerty-circle-timing':header,authorization:token}})})
const decode = response => JSON.parse(Buffer.from(response.headers.get('X-Qwerty-Circle-Timing'),'base64url').toString('utf8'))
test('profile is exact-etest opt-in authenticated-success metadata only',async()=>{
  for(const ctx of [request('master'),request(''),request('other'),request('etest','0'),request('etest','1',''),request('etest','1','Bearer fixture','/api/auth/me')]){
    const response=await profileCircleRequest(ctx,()=>new Response('{}'))
    assert.equal(response.headers.has('X-Qwerty-Circle-Timing'),false)
  }
  for(const status of [401,403,429,503]){
    const response=await profileCircleRequest(request(),()=>new Response('{}',{status}))
    assert.equal(response.headers.has('X-Qwerty-Circle-Timing'),false)
  }
})
test('timing preserves return values, receiver, errors and records categories without arguments',async()=>{
  const failure=new Error('secret-token body')
  const raw={value:{nickname:'private-person'},get(key){assert.equal(this,raw);if(key==='reject')return Promise.reject(failure);return Promise.resolve(this.value)}}
  const response=await profileCircleRequest(request(),async()=>{
    const store=profileCircleStore(raw)
    assert.equal(await timeCircleStage('authenticate',()=>store.get('accounts/secret-account/identity.json')),raw.value)
    await assert.rejects(store.get('reject'),error=>error===failure)
    return new Response('{"ok":true}',{status:200})
  })
  assert.equal(await response.text(),'{"ok":true}')
  const profile=decode(response)
  assert.equal(profile.version,1)
  assert.ok(profile.totalMs>=0)
  assert.ok(profile.spans.some(s=>s.name==='identity'))
  assert.ok(profile.spans.some(s=>s.name==='authenticate'))
  assert.doesNotMatch(JSON.stringify(profile),/secret|private-person|nickname|accounts\//)
  assert.equal(profileCircleStore(raw),raw)
})
test('profiles are request-isolated and bounded',async()=>{
  const outputs=await Promise.all(['identity','revocation'].map(name=>profileCircleRequest(request(),async()=>{
    const store=profileCircleStore({async get(){}})
    const key=name==='identity'?'accounts/private/identity.json':'accounts/private/independent-sessions/revoked/token.json'
    for(let i=0;i<120;i++)await store.get(key)
    return new Response('{}')
  })))
  for(let i=0;i<outputs.length;i++){
    assert.ok(outputs[i].headers.get('X-Qwerty-Circle-Timing').length<=6000)
    const profile=decode(outputs[i]);assert.equal(profile.truncated,true)
    assert.ok(profile.spans.length<=96)
    assert.ok(profile.spans.every(s=>s.name===(i===0?'identity':'revocation')))
  }
})
