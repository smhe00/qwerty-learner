/* eslint-env node */
import { performance } from 'node:perf_hooks'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const origin = process.env.CIRCLE_TIMING_ORIGIN || 'https://t.smhe.cn'
if (origin !== 'https://t.smhe.cn') throw new Error('Circle latency probe is etest-only')
const expected = process.env.CIRCLE_TARGET_SHA || ''
if (!/^[a-f0-9]{40}$/.test(expected)) throw new Error('Exact CIRCLE_TARGET_SHA required')
const count = Number(process.env.CIRCLE_SAMPLE_COUNT || 10)
if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('Sample count outside1..10')
const output = process.env.CIRCLE_TIMING_OUTPUT || 'blob-report/circle-latency.json'
const report = { expected, samples: [], healthMs: [], startedAt: new Date().toISOString(), closed: false }
const save = () => {fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2))}
let auth, circleId, failure
async function request(route, body, method='GET', profile=false) {
  const start = performance.now()
  const response = await globalThis.fetch(origin+route,{method,headers:{...(auth?{Authorization:'Bearer '+auth.token}:{}),...(profile?{'X-Qwerty-Circle-Timing':'1'}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:globalThis.AbortSignal.timeout(60000),redirect:'error'})
  const data=await response.json()
  const clientMs=Math.round((performance.now()-start)*10)/10
  if(!response.ok||data.ok!==true)throw Error('HTTP '+response.status+' '+String(data.error||'unconfirmed'))
  const encoded=response.headers.get('X-Qwerty-Circle-Timing')
  const timing=encoded?JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')):null
  return {data,clientMs,timing}
}
try {
  const marker=await globalThis.fetch(origin+'/source-commit.txt?probe='+Date.now(),{cache:'no-store',signal:globalThis.AbortSignal.timeout(20000)})
  const source=(await marker.text()).trim()
  if(!marker.ok||source.length<7||!expected.startsWith(source))throw Error('Source mismatch '+source.slice(0,40))
  report.source=source;save()
  const registered=await request('/api/auth/register',{username:'cp'+crypto.randomBytes(10).toString('hex'),password:crypto.randomBytes(18).toString('base64url'),deviceId:crypto.randomUUID()},'POST')
  auth=registered.data
  const created=await request('/api/circle/v2',{name:'圈子分段性能验收',nickname:'测速同学',passphrase:'一起学习 '+crypto.randomBytes(8).toString('hex'),operationId:crypto.randomUUID()},'POST',true)
  circleId=created.data.result.circleId
  if(!/^[a-f0-9]{24}$/.test(circleId))throw Error('Circle receipt unconfirmed')
  for(let i=0;i<3;i++)report.healthMs.push((await request('/api/health')).clientMs)
  const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10)
  for(const action of ['read','checkin'])for(let i=0;i<count;i++){
    const r=await request('/api/circle/v2/'+circleId+(action==='read'?'':'/progress/'+day),action==='read'?undefined:{eventId:crypto.randomUUID(),completed:true,newWords:20},action==='read'?'GET':'POST',true)
    if(!r.timing)throw Error('Authenticated etest timing header missing')
    report.samples.push({action,index:i,clientMs:r.clientMs,serverMs:r.timing.totalMs,profile:r.timing});save()
    console.log(JSON.stringify({action,index:i,clientMs:r.clientMs,serverMs:r.timing.totalMs}))
  }
  const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]
  report.summary={}
  for(const action of ['read','checkin']){const rows=report.samples.filter(s=>s.action===action);report.summary[action]={n:rows.length,clientP50:percentile(rows.map(s=>s.clientMs),.5),clientP95:percentile(rows.map(s=>s.clientMs),.95),serverP50:percentile(rows.map(s=>s.serverMs),.5),serverP95:percentile(rows.map(s=>s.serverMs),.95),allClientUnder1s:rows.every(s=>s.clientMs<1000),allServerUnder1s:rows.every(s=>s.serverMs<1000)}}
  console.log(JSON.stringify({healthMs:report.healthMs,summary:report.summary}));report.measured=true
} catch(error) { failure=error;report.error=error.message;console.error(error.message) }
finally {
  if(circleId&&auth){try{await request('/api/circle/v2/'+circleId+'/close',{},'POST');report.closed=true;report.syntheticUserId=auth.user.userId;report.socialDeletionHold=true}catch(error){failure ||=error;report.cleanupError=error.message}}
  report.completedAt=new Date().toISOString();save()
}
if(failure)process.exitCode=1