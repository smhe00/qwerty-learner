/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'
import { build } from 'esbuild'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'

test('real Circle handler receives native body before asynchronous account lookup, once, without bypassing authorization', async () => {
  const blobs = new Map()
  let lookupStarted = false
  const hooks = {list:null}
  globalThis.__circleNativeStore = {
    async get(key) { lookupStarted = true; return structuredClone(blobs.get(key) ?? null) },
    async setJSON(key, value) { blobs.set(key, structuredClone(value)) },
    async delete(key) { blobs.delete(key) },
    async list({prefix}) { if(hooks.list)await hooks.list(prefix);return {blobs:[...blobs.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))} },
  }
  const built = await build({entryPoints:['cloud-functions/api/[[default]].js'],bundle:true,platform:'node',target:'node20',format:'esm',write:false,
    plugins:[{name:'circle-native-store',setup(b){b.onResolve({filter:/^@edgeone\/pages-blob$/},()=>({path:'store',namespace:'circle-native'}));b.onLoad({filter:/.*/,namespace:'circle-native'},()=>({contents:'export const getStore = () => globalThis.__circleNativeStore'}))}}]})
  const {onRequest}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))
  const env={branch:'etest',AUTH_RATE_LIMIT_REQUESTS:'1000',IDLE_CLEANUP_EXECUTE:'false'}
  const registration=await onRequest({env,clientIp:'192.0.2.119',request:new Request('https://internal.invalid/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'native_circle_fixture',password:'fixture-password',deviceId:'native-circle'})})})
  assert.equal(registration.status,201)
  const account=await registration.json()
  let reads=0
  async function create(body, token=account.token, path='') {
    lookupStarted=false
    const request=new Request('https://internal.invalid/api/circle/v2'+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)})
    const native=request.arrayBuffer.bind(request)
    request.arrayBuffer=()=>{reads++;assert.equal(lookupStarted,false,'body must be received before any asynchronous store lookup');return native()}
    request.clone=()=>{throw Error('clone must not be used')}
    Object.defineProperty(request,'body',{get(){throw Error('Web stream is unavailable')}})
    const result=await onRequest({env,clientIp:'192.0.2.119',request})
    return {status:result.status,body:await result.json()}
  }
  const payload={name:'hh',passphrase:'每天学 English',nickname:'原生昵称',operationId:crypto.randomUUID()}
  const denied=await create(payload,null)
  assert.equal(denied.status,401)
  assert.equal([...blobs.keys()].some(k=>k.startsWith('social/')),false)
  const invalid=await create({...payload,actor:'forged'})
  assert.equal(invalid.body.error,'unexpected_field')
  assert.equal([...blobs.keys()].some(k=>k.startsWith('social/')),false)
  const created=await create(payload)
  assert.equal(created.status,202)
  assert.equal(reads,3)
  assert.equal(created.body.result.inviteCode,payload.passphrase)
  const id=created.body.result.circleId
  assert.equal(blobs.get('social/v3/circles/'+id+'/members/'+account.user.userId+'.json').nickname,'原生昵称')
  const changed=await create({passphrase:'共同学习 ABC'},account.token,'/'+id+'/invite')
  assert.equal(changed.status,202)
  assert.equal(changed.body.result.inviteCode,'共同学习 ABC')
  const old=await create({inviteCode:payload.passphrase},account.token,'/join')
  assert.equal(old.body.error,'invalid_invite')
  const current=await create({inviteCode:'共同学习 ABC'},account.token,'/join')
  assert.equal(current.status,202)
  assert.equal(current.body.result.circleId,id)
  assert.equal(reads,6)
  for (const branch of ['etest','master']) {
    const profiled=await onRequest({env:{...env,branch},clientIp:'192.0.2.119',request:new Request('https://internal.invalid/api/circle/v2/'+id,{headers:{authorization:'Bearer '+account.token,'x-qwerty-circle-timing':'1'}})})
    assert.equal(profiled.status,200)
    const trace=profiled.headers.get('X-Qwerty-Circle-Timing')
    assert.equal(Boolean(trace),branch==='etest')
    if(trace){const decoded=JSON.parse(Buffer.from(trace,'base64url'));assert.ok(decoded.spans.some(s=>s.name==='authenticate'));assert.doesNotMatch(JSON.stringify(decoded),new RegExp(account.user.userId))}
  }
  for (const change of ['fence','revocation']) {
    let release,entered;const gate=new Promise(resolve=>{release=resolve}),arrival=new Promise(resolve=>{entered=resolve})
    hooks.list=async prefix=>{if(prefix.startsWith('social/v3/circles/'+id+'/days/')){entered();await gate}}
    const pending=onRequest({env,clientIp:'192.0.2.119',request:new Request('https://internal.invalid/api/circle/v2/'+id,{headers:{authorization:'Bearer '+account.token,'x-qwerty-circle-timing':'1'}})})
    await arrival
    const fence='maintenance/idle/v1/'+account.user.userId+'/fence.json'
    if(change==='fence')blobs.set(fence,{phase:'draining',userId:account.user.userId,createdAt:Date.now()})
    else await createEdgeOneBlobStorage(globalThis.__circleNativeStore).revokeSessionToken(account.token.split('.')[1],crypto.createHash('sha256').update(account.token).digest('hex'))
    release();const denied=await pending;hooks.list=null
    assert.equal(denied.status,change==='fence'?423:401)
    assert.equal(denied.headers.has('X-Qwerty-Circle-Timing'),false)
    assert.doesNotMatch(await denied.text(),/原生昵称/)
    blobs.delete(fence)
  }
  delete globalThis.__circleNativeStore
})
