/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'
import { build } from 'esbuild'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'

// Exercise the shipped router, handoff, SDK wrapper, backend and idle guard.
// Every request gets its own service: never share authorization between calls.
test('native startup reads preserve fresh sessions, account isolation and final checkpoint cleanup/revocation checks', async () => {
  const objects = new Map(), calls = []
  let hook = null
  globalThis.__startupSyncStore = {
    async get(key) { calls.push(['get',key]); await hook?.(key); return structuredClone(objects.get(key) ?? null) },
    async setJSON(key,value) { calls.push(['set',key]); objects.set(key,structuredClone(value)) },
    async delete(key) { objects.delete(key) },
    async list({prefix}) { calls.push(['list',prefix]); return {blobs:[...objects.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))} },
  }
  const built = await build({entryPoints:['cloud-functions/api/[[default]].js'],bundle:true,platform:'node',target:'node20',format:'esm',write:false,
    plugins:[{name:'startup-native-store',setup(b){b.onResolve({filter:/^@edgeone\/pages-blob$/},()=>({path:'store',namespace:'startup-native'}));b.onLoad({filter:/.*/,namespace:'startup-native'},()=>({contents:'export const getStore = () => globalThis.__startupSyncStore'}))}}]})
  const {onRequest}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))
  const env={branch:'etest',AUTH_RATE_LIMIT_REQUESTS:'1000',IDLE_CLEANUP_EXECUTE:'false'}
  const request = (path,token,body,method=body?'POST':'GET') => onRequest({env,clientIp:'192.0.2.120',request:new Request('https://internal.invalid/api'+path,{method,
    headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})})
  const deviceId='qwerty-web-'+crypto.randomUUID()
  const registration=await request('/auth/register',null,{username:'startup_perf_fixture',password:'fixture-password',deviceId})
  assert.equal(registration.status,201); const auth=await registration.json()
  const event={attemptId:crypto.randomUUID(),dict:'synthetic',word:'hello',timeStamp:1800000000,chapter:-1,timing:[],wrongCount:0,mistakes:{},sourceMode:'learn',learnItemKind:'acquisition'}
  const published=await request('/sync/events/v2',auth.token,{deviceId,batchId:crypto.randomUUID(),sequence:1,previous:null,events:[event]})
  assert.equal(published.status,201);const batch=await published.json()
  const heads=[Object.fromEntries(['deviceId','batchId','sequence','sha256'].map(k=>[k,batch[k]]))]
  const verified=await request('/sync/events/v2/verify-set',auth.token,{heads,segmented:true})
  assert.equal(verified.status,200);const proof=await verified.json();assert.equal(proof.verified,true)
  const query={heads,segmented:true,cursor:proof.cursor}
  calls.length=0
  const repeated=await request('/sync/events/v2/verify-set',auth.token,query)
  assert.equal(repeated.status,200);assert.deepEqual(await repeated.json(),proof)
  assert.equal(calls.filter(([method,key])=>method==='set'&&key.includes('/_history/')).length,0)
  const authReads=calls.filter(([method,key])=>method==='get'&&key.endsWith('/identity.json')).length
  // One handoff classification, one initial auth and one post-checkpoint auth.
  assert.equal(authReads,3)
  for (const path of ['/sync/v2/meta','/sync/events/v2/observed']) {
    assert.equal((await request(path,auth.token)).status,200)
    assert.equal((await request(path,null)).status,401)
  }
  const other=await (await request('/auth/register',null,{username:'startup_perf_other',password:'fixture-password',deviceId})).json()
  const cross=await request('/sync/events/v2/verify-set',other.token,query)
  assert.equal(cross.status,200);assert.equal((await cross.json()).verified,false)
  assert.equal((await (await request('/sync/events/v2/observed',other.token)).json()).observedCount,0)
  const fence='maintenance/idle/v1/'+auth.user.userId+'/fence.json'
  for (const change of ['fence','revocation']) {
    let reached=false
    hook=async key=>{
      if(!reached&&key.includes('/_history/')) {
        reached=true
        if(change==='fence') objects.set(fence,{phase:'draining',userId:auth.user.userId,createdAt:Date.now()})
        else await createEdgeOneBlobStorage(globalThis.__startupSyncStore).revokeSessionToken(auth.token.split('.')[1],crypto.createHash('sha256').update(auth.token).digest('hex'))
      }
    }
    const denied=await request('/sync/events/v2/verify-set',auth.token,query)
    assert.equal(reached,true);assert.equal(denied.status,change==='fence'?423:401)
    assert.equal('evidenceSha256' in await denied.json(),false)
    hook=null;objects.delete(fence)
  }
  for(const path of ['/sync/v2/meta','/sync/events/v2/observed']) assert.equal((await request(path,auth.token)).status,401)
  delete globalThis.__startupSyncStore
})
