/* eslint-env node */
/*
 * Isolated etest-only 5.9 MB gzip multipart latency probe.
 * No production writes; no deployment. Immutable part retries only.
 * Ambiguous final Commit is never replayed. Disposable account deleted.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { verifyCompressedV4 } from '../cloud-functions/_shared/sync-v4.js'

const origin = 'https://etest.edgeone.dev/'
const targetGzipBytes = 5_900_000 // 5.9 decimal MB, approximately 5.63 MiB.
const partBytes = 512 * 1024
const samples = 3
if (process.env.ETEST_5P9M_ACK !== 'ISOLATED_ETEST_5900000_GZIP') {
  throw Error('Explicit etest-only isolated-benchmark acknowledgement required')
}
const sha = x => crypto.createHash('sha256').update(x).digest('hex')
const now = () => performance.now()
const ms = x => Math.round(x * 100) / 100
const sleep = t => new Promise(resolve => setTimeout(resolve, t))
const sorted = x => [...x].sort((a,b) => a-b)
function stable(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']'
  return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}'
}
async function http(path, method = 'GET', body, token, opts = {}) {
  const headers = { Accept: 'application/json', ...opts.headers }
  if (token) headers.Authorization = 'Bearer ' + token
  const outgoing = Buffer.isBuffer(body) ? body
    : body === undefined ? undefined : JSON.stringify(body)
  if (outgoing && !opts.headers?.['Content-Type'])
    headers['Content-Type'] = 'application/json'
  const start = now()
  const rsp = await fetch(new URL(path, origin), {
    method, headers, body: outgoing,
    signal: AbortSignal.timeout(opts.timeoutMs || 45000), redirect: 'error',
  })
  const raw = await rsp.text()
  let data
  try { data = JSON.parse(raw) } catch { data = null }
  return { status: rsp.status, data, elapsedMs: ms(now() - start),
    requestBytes: outgoing?.length || 0 }
}
function fixture(accountId, baseRevision) {
  const names = ['achievementEvents','achievementStates','chapterRecords',
    'reviewRecords','reviewWordStates','wordRecords']
  const tables = names.map(name => ({ name, schema: '++id' }))
  const entropy = crypto.randomBytes(targetGzipBytes + 50000)
  let n = targetGzipBytes - 23000
  let bytes, fingerprint
  for (let i=0; i<8; i++) {
    const data = names.map(tableName => ({
      tableName, inbound: true, rows: tableName === 'wordRecords' ? [{
        id: 1, word: 'isolated-5900000-byte-probe',
        typingTelemetry: { synthetic: entropy.subarray(0,n).toString('base64') },
      }] : [],
    }))
    const workspaceData = {
      database: { formatName: 'dexie', formatVersion: 1, data: {
        databaseName: 'RecordDB', databaseVersion: 6, tables, data,
      } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: {} },
      navigation: { currentDict: 'isolated-performance-test', currentChapter: 0 },
    }
    fingerprint = sha(stable({
      database: { tables, data }, learnRuntime: workspaceData.learnRuntime,
      settings: workspaceData.settings, navigation: workspaceData.navigation,
    }))
    const snapshot = {
      backupFormatVersion: 'qwerty-backup-v4',
      metadata: { createdAt: '2026-10-15T00:00:00.000Z',
        source: { kind: 'account', accountId } },
      workspaceData,
    }
    bytes = gzipSync(Buffer.from(JSON.stringify(snapshot)))
    const delta = targetGzipBytes - bytes.length
    if (Math.abs(delta) < 250) break
    n += delta
    assert.ok(n > 1000 && n <= entropy.length)
  }
  assert.ok(Math.abs(bytes.length - targetGzipBytes) < 500,
    'Gzip fixture size must be approximately 5,900,000 bytes')
  assert.equal(verifyCompressedV4(bytes, accountId, fingerprint).logicalFingerprint,
    fingerprint, 'Canonical V4 fixture must validate before writing')
  return { bytes, fingerprint, baseRevision }
}
async function verifyReadback(token, fixture, revision) {
  const start = now()
  const meta = await http('/api/sync/v2/meta','GET',undefined,token)
  assert.equal(meta.status,200)
  assert.equal(meta.data.revision,revision)
  assert.equal(meta.data.payloadSha256,sha(fixture.bytes))
  assert.equal(meta.data.logicalFingerprint,fixture.fingerprint)
  assert.equal(meta.data.storageEncoding,'binary')
  const manifest = await http('/api/sync/v2/binary/manifest','GET',undefined,token)
  assert.equal(manifest.status,200)
  assert.equal(manifest.data.revision,revision)
  assert.equal(manifest.data.payloadSha256,sha(fixture.bytes))
  assert.equal(manifest.data.chunkBytes,partBytes)
  const count = Math.ceil(fixture.bytes.length / partBytes)
  assert.equal(manifest.data.count,count)
  const downloaded = []
  let readbackHttpMs=0
  for (let index=0;index<count;index++) {
    const qs = new URLSearchParams({
      revision:String(revision), sha:sha(fixture.bytes),index:String(index) })
    const t=now()
    const res=await fetch(new URL('/api/sync/v2/binary/part?'+qs,origin),{
      headers:{Authorization:'Bearer '+token},
      signal:AbortSignal.timeout(45000),redirect:'error' })
    assert.equal(res.status,200,'immutable binary part GET '+index)
    const part=Buffer.from(await res.arrayBuffer())
    readbackHttpMs+=now()-t
    assert.equal(sha(part),manifest.data.partSha256s[index])
    downloaded.push(part)
  }
  const recombined=Buffer.concat(downloaded)
  assert.equal(recombined.length,fixture.bytes.length)
  assert.equal(sha(recombined),sha(fixture.bytes))
  assert.deepEqual(recombined,fixture.bytes)
  return { readbackMs:ms(now()-start),
    partGetMsSum:ms(readbackHttpMs),verifiedParts:count }
}
async function stageParts(token, fixture, sample) {
  const started=now(), bytes=fixture.bytes, payloadSha=sha(bytes)
  const count=Math.ceil(bytes.length/partBytes)
  const partHashes=Array.from({length:count},(_,i)=>
    sha(bytes.subarray(i*partBytes,(i+1)*partBytes)))
  let cursor=0, failed=null
  const measurements=[]
  const delays=[0,150,350,750,1500,3000]
  async function uploadPart(index) {
    const payload=bytes.subarray(index*partBytes,(index+1)*partBytes)
    for (let attempt=0;attempt<delays.length;attempt++) {
      if (attempt) await sleep(delays[attempt])
      let reply
      const st=now()
      try {
        reply=await http('/api/sync/v2/parts','POST',payload,token,{
          headers: {
            'Content-Type':'application/octet-stream',
            'X-Qwerty-Payload-Sha256':payloadSha,
            'X-Qwerty-Part-Sha256':partHashes[index],
            'X-Qwerty-Part-Index':String(index),
            'X-Qwerty-Part-Count':String(count),
            'X-Qwerty-Chunk-Bytes':String(partBytes),
          }, timeoutMs:45000 })
      } catch(e) {
        reply={status:503,data:{error:e?.name||'transport_error'},
          elapsedMs:ms(now()-st),requestBytes:payload.length}
      }
      const timing=reply.data?.timings || reply.data?.details?.timings
      const row={sample,index,attempt:attempt+1,partBytes:payload.length,
        status:reply.status,httpMs:reply.elapsedMs,
        error:reply.data?.error||null,
        blobWriteMs:timing?.blobWriteMs??null,
        serverMs:timing?.serverTotalMs??null }
      measurements.push(row)
      console.log('GZ5900_PART '+JSON.stringify(row))
      if (reply.status===200) {
        assert.equal(reply.data?.received,true)
        assert.equal(reply.data?.payloadSha256,payloadSha)
        assert.equal(reply.data?.index,index)
        assert.equal(reply.data?.partSha256,partHashes[index])
        return
      }
      // Only immutable part keys may be retried on 5xx or network failures.
      // 400/401/403/409/413 means fail fast, never retry or commit.
      if (reply.status<500 || reply.status>599) {
        throw Error('part_rejected_'+reply.status+'_'+(reply.data?.error||'unknown'))
      }
    }
    throw Error('part_5xx_retry_exhausted_'+index)
  }
  const worker=async()=> {
    while (!failed && cursor<count) {
      const i=cursor++
      try{ await uploadPart(i) }catch(e){ failed ||= e }
    }
  }
  await Promise.all(Array.from({length:Math.min(3,count)},()=>worker()))
  const stageMs=ms(now()-started)
  const stage={
    count,concurrency:3,stageWallMs:stageMs,
    partHttpMsSum:ms(measurements.reduce((s,x)=>s+x.httpMs,0)),
    stageAttempts:measurements.length,
    retries:measurements.length-count,
    successfulParts:measurements.filter(x=>x.status===200).length,
    statusCounts:measurements.reduce((s,x)=>
      ({...s,[x.status]:(s[x.status]||0)+1}),{}),
    measurements,
  }
  console.log('GZ5900_STAGE '+JSON.stringify({
    sample,compressedBytes:bytes.length,...stage,measurements:undefined,
    stageError:failed?.message||null }))
  if (failed) throw failed
  return { stage,payloadSha,partHashes,count,started }
}
async function putAndVerify(token,userId,baseRevision,sample){
  const f=fixture(userId,baseRevision)
  console.log('GZ5900_FIXTURE '+JSON.stringify({
    sample,compressedBytes:f.bytes.length,
    decimalMB:ms(f.bytes.length/1e6),
    kib:ms(f.bytes.length/1024),
    count:Math.ceil(f.bytes.length/partBytes),
    stageConcurrency:3 }))
  const s=await stageParts(token,f,sample)
  const commitT=now()
  let reply
  try {
    reply=await http('/api/sync/v2/commit','POST',{
      baseRevision:f.baseRevision,
      logicalFingerprint:f.fingerprint,
      clientFormatVersion:'qwerty-backup-v4',
      deviceId:'isolated-5900000-byte-probe',
      payloadSha256:s.payloadSha,
      count:s.count,
      wirePartBytes:partBytes,
      partSha256s:s.partHashes,
    },token,{timeoutMs:65000})
  } catch(e) {
    const m=await http('/api/sync/v2/meta','GET',undefined,token)
    console.error('GZ5900_COMMIT_AMBIGUOUS '+JSON.stringify({
      sample,name:e?.name||'transport_error',
      expectedRevision:baseRevision+1,observedRevision:m.data?.revision??null,
      actualShaMatches:m.data?.payloadSha256===s.payloadSha }))
    throw e // NEVER retry ambiguous final commit
  }
  const totalMs=ms(now()-s.started), commitMs=ms(now()-commitT)
  console.log('GZ5900_COMMIT '+JSON.stringify({
    sample,status:reply.status,error:reply.data?.error||null,
    stageWallMs:s.stage.stageWallMs,commitMs,
    totalWriteMs:totalMs,replyRevision:reply.data?.revision??null,
    serverTiming:reply.data?.timings||reply.data?.details?.timings||null }))
  if (reply.status!==200) {
    const m=await http('/api/sync/v2/meta','GET',undefined,token)
    console.error('GZ5900_COMMIT_FAILURE '+JSON.stringify({
      sample,expectedRevision:baseRevision+1,
      observedRevision:m.data?.revision??null,
      actualShaMatches:m.data?.payloadSha256===s.payloadSha }))
    throw Error('commit_failed_without_retry_'+reply.status)
  }
  assert.equal(reply.data?.revision,baseRevision+1)
  assert.equal(reply.data?.payloadSha256,s.payloadSha)
  assert.equal(reply.data?.logicalFingerprint,f.fingerprint)
  assert.equal(reply.data?.storageEncoding,'binary')
  const readback=await verifyReadback(token,f,baseRevision+1)
  const result={
    sample,compressedBytes:f.bytes.length,parts:s.count,
    success:true,totalWriteMs:totalMs,stageWallMs:s.stage.stageWallMs,
    commitMs,stageAttempts:s.stage.stageAttempts,retries:
      s.stage.stageAttempts-s.count,readbackVerified:true,...readback,
  }
  console.log('GZ5900_RESULT '+JSON.stringify(result))
  return result
}
const health=await http('/api/health')
assert.equal(health.status,200)
assert.ok(health.data?.capabilities?.includes('v4-end-to-end-binary-v1'))
assert.ok(health.data?.capabilities?.includes('v4-binary-direct-512k-v1'))
console.log('GZ5900_PREFLIGHT '+JSON.stringify({
  environment:'etest',backendBinaryV4:true,targetCompressedBytes:targetGzipBytes,
  accountQuotaDefaultBytes:4*1024*1024,quotaOverrideUnknown:true,
  noMasterWrites:true }))
const username='gz5900'+Date.now().toString(36)+crypto.randomBytes(4).toString('hex')
const password=crypto.randomBytes(20).toString('base64url')
let account=null, failure=null
const results=[]
try {
  const created=await http('/api/auth/register','POST',{
    username,password,deviceId:'gz5900-test-only' })
  assert.equal(created.status,201,'isolated account registration')
  account={token:created.data?.token,userId:created.data?.user?.userId}
  assert.ok(account.token&&account.userId)
  const m=await http('/api/sync/v2/meta','GET',undefined,account.token)
  assert.equal(m.status,200)
  assert.equal(m.data?.revision,0)
  for (let sample=1;sample<=samples;sample++)
    results.push(await putAndVerify(account.token,account.userId,sample-1,sample))
  const arr=sorted(results.map(x=>x.totalWriteMs))
  console.log('GZ5900_SUMMARY '+JSON.stringify({
    samples:arr.length,successes:results.length,compressedTargetBytes:targetGzipBytes,
    medianUploadMs:arr[Math.floor(arr.length/2)],
    minUploadMs:arr[0],maxUploadMs:arr.at(-1),
    meanUploadMs:ms(arr.reduce((s,x)=>s+x,0)/arr.length),
    medianReadbackMs:sorted(results.map(x=>x.readbackMs))[1],
  }))
} catch(e){failure=e;console.error('GZ5900_STOP '+JSON.stringify({
  message:e?.message||String(e),samplesCompleted:results.length }))
} finally {
  if(account) {
    try {
      const deleted=await http('/api/auth/account','DELETE',
        {currentPassword:password},account.token)
      assert.equal(deleted.status,200)
      assert.equal(deleted.data?.deleted?.accountDeleted,true)
      console.log('GZ5900_CLEANUP PASS')
    }catch(e){console.error('GZ5900_CLEANUP FAILED');failure||=e}
  }
}
if(failure)throw failure
