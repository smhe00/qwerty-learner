/* eslint-env node */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { PausableBlob, fixture } from './session-handoff-fixtures.mjs'
import crypto from 'node:crypto'
let directory, onRequest
before(async () => {
 directory=await mkdtemp(join(tmpdir(),'handoff-production-off-'))
 const outfile=join(directory,'gateway.mjs')
 await build({entryPoints:['cloud-functions/api/[[default]].js'],outfile,bundle:true,format:'esm',platform:'node',target:'node22',logLevel:'silent',plugins:[{
 name:'fake-provider-only',setup(builder){
 builder.onResolve({filter:/^@edgeone\/pages-blob$/},()=>({path:'blob',namespace:'provider'}))
 builder.onLoad({filter:/.*/,namespace:'provider'},()=>({contents:'export const getStore = options => globalThis.__productionOffStore(options)',loader:'js'}))
 }}]})
 ;({onRequest}=await import(pathToFileURL(outfile)))
})
after(async()=>{delete globalThis.__productionOffStore;await rm(directory,{recursive:true,force:true})})
test('production off: health and reserved-name login/V4 stay on ordinary single-session path',async()=>{
 const stores=new Map(),reads=[]
 globalThis.__productionOffStore=({name})=>{
  assert.notEqual(name,'qwerty-handoff-qualification')
  if(!stores.has(name))stores.set(name,new PausableBlob())
  return stores.get(name)
 }
 async function call(path,{method='GET',token,body,bytes,headers={}}={}){
 const request=new Request('https://internal-maker.invalid/api'+path,{method,headers:{Origin:'https://t.smhe.cn',Host:'t.smhe.cn','X-Qwerty-Handoff-Hold-Ms':'5000',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(bytes?{body:bytes}:body?{body:JSON.stringify(body)}:{})})
 const read=request.arrayBuffer.bind(request);let count=0
 request.arrayBuffer=()=>{assert.equal(++count,1);return read()}
 request.clone=()=>{throw Error('clone forbidden')}
 const response=await onRequest({request,clientIp:'192.0.2.9',env:{branch:'master',AUTH_RATE_LIMIT_REQUESTS:'1000',HANDOFF_EXPERIMENT_ENABLED:'true'}})
 reads.push({path,count})
 assert.equal(response.headers.get('x-qwerty-handoff'),null)
 return {status:response.status,data:await response.json()}
 }
 const health=await call('/health')
 assert.equal(health.status,200)
 assert.equal(health.data.capabilities.includes('account-handoff-blob-fixtures-v1'),false)
 assert.equal(health.data.handoffMode,undefined)
 assert.equal(health.data.capabilities.includes('idle-auto-policy-v1'),true)
 const username='qh26'+crypto.randomBytes(12).toString('hex'),password='synthetic-test-only'
 const first=await call('/auth/register',{method:'POST',body:{username,password,deviceId:'A'}})
 assert.equal(first.status,201,JSON.stringify(first.data))
 assert.equal((await call('/auth/login',{method:'POST',body:{username,password:'wrong',deviceId:'B'}})).data.error,'incorrect_password')
 assert.equal((await call('/auth/login',{method:'POST',body:{username:'missing'+username.slice(0,16),password,deviceId:'B'}})).data.error,'account_not_found')
 const input=fixture(first.data.user.userId,'alpha')
 const uploaded=await call('/sync/v2/binary/direct',{method:'POST',token:first.data.token,bytes:input.payloadBytes,headers:{'Content-Type':'application/octet-stream','X-Qwerty-Base-Revision':'0','X-Qwerty-Logical-Fingerprint':input.logicalFingerprint,'X-Qwerty-Payload-Sha256':crypto.createHash('sha256').update(input.payloadBytes).digest('hex'),'X-Qwerty-Device-Id':'A'}})
 assert.equal(uploaded.status,200,JSON.stringify(uploaded.data))
 const second=await call('/auth/login',{method:'POST',body:{username,password,deviceId:'B'}})
 assert.equal(second.status,200,JSON.stringify(second.data))
 assert.equal((await call('/auth/me',{token:first.data.token})).status,401)
 assert.equal((await call('/sync/v2/meta',{token:second.data.token})).data.revision,1)
 assert.equal((await call('/auth/handoff/status',{token:second.data.token})).status,404)
 assert.ok(reads.filter(x=>x.path.startsWith('/auth/')&&x.count).every(x=>x.count===1))
 assert.equal((await call('/auth/account',{method:'DELETE',token:second.data.token,body:{currentPassword:password}})).status,200)
})
