/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'
import { build } from 'esbuild'

test('feedback captures bounded native body before async auth/storage and still enforces ownership and administrator status', async () => {
  const blobs = new Map()
  let lookupStarted = false, reads = 0
  globalThis.__feedbackNativeStore = {
    async get(key) { lookupStarted = true; return structuredClone(blobs.get(key) ?? null) },
    async setJSON(key, value) { blobs.set(key, structuredClone(value)) },
    async delete(key) { blobs.delete(key) },
    async list({prefix}) { return {blobs:[...blobs.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))} },
  }
  try {
    const built = await build({entryPoints:['cloud-functions/api/[[default]].js'],bundle:true,platform:'node',target:'node20',format:'esm',write:false,
      plugins:[{name:'feedback-native-store',setup(b){b.onResolve({filter:/^@edgeone\/pages-blob$/},()=>({path:'store',namespace:'feedback-native'}));b.onLoad({filter:/.*/,namespace:'feedback-native'},()=>({contents:'export const getStore = () => globalThis.__feedbackNativeStore'}))}}]})
    const {onRequest}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))
    const env={branch:'etest',AUTH_RATE_LIMIT_REQUESTS:'1000',IDLE_CLEANUP_EXECUTE:'false'}
    const registration=await onRequest({env,clientIp:'192.0.2.120',request:new Request('https://internal.invalid/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'native_feedback_fixture',password:'fixture-password',deviceId:'native-feedback'})})})
    assert.equal(registration.status,201)
    const account=await registration.json()
    const post = async (body, headers={}, path='/feedback', branch='etest') => {
      lookupStarted=false
      const request=new Request('https://internal.invalid/api'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
      const native=request.arrayBuffer.bind(request)
      request.arrayBuffer=()=>{reads++;if(lookupStarted) throw Error('Native request body released after async storage');return native()}
      request.clone=()=>{throw Error('clone must not be used')}
      Object.defineProperty(request,'body',{get(){throw Error('Web stream is unavailable')}})
      const result=await onRequest({env:{...env,branch},clientIp:'192.0.2.120',request})
      return {status:result.status,body:await result.json()}
    }
    const payload={operationId:crypto.randomBytes(16).toString('hex'),title:'Native body',text:'Synthetic content'}
    assert.equal((await post(payload)).status,401)
    assert.equal([...blobs.keys()].some(k=>k.startsWith('feedback/')),false)
    const auth={authorization:'Bearer '+account.token}
    const created=await post(payload,auth)
    assert.equal(created.status,200,JSON.stringify(created.body))
    const replyPath='/feedback/'+created.body.owner+'/'+created.body.id+'/messages'
    const before=blobs.size
    assert.equal((await post({operationId:crypto.randomBytes(16).toString('hex'),status:'resolved'},auth,replyPath)).status,403)
    assert.equal(blobs.size,before,'ordinary author cannot modify administrator status')
    const reply=await post({operationId:crypto.randomBytes(16).toString('hex'),text:'Follow up'},auth,replyPath)
    assert.equal(reply.status,200)
    assert.equal((await post({operationId:crypto.randomBytes(16).toString('hex'),text:'x'.repeat(17000)},auth)).status,413)
    const guest={'x-feedback-key':crypto.randomBytes(32).toString('hex')}
    assert.equal((await post({...payload,operationId:crypto.randomBytes(16).toString('hex')},guest,'/feedback','master')).status,200)
    assert.equal(reads,6,'one native body read per request')
  } finally {delete globalThis.__feedbackNativeStore}
})
