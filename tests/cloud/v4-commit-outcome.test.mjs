import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reconcileUnknownV4Commit } from './v4-commit-outcome.mjs'
const expected = { baseRevision: 7, logicalFingerprint: 'a'.repeat(64), payloadSha256: 'b'.repeat(64) }
const committed = { hasData:true, revision:8, logicalFingerprint:expected.logicalFingerprint,
  payloadSha256:expected.payloadSha256, clientFormatVersion:'qwerty-backup-v4', storageEncoding:'binary' }
const run = overrides => reconcileUnknownV4Commit({ expected, sleep:async()=>{}, maxChecks:3,
  readMeta:async()=>committed, verifyPinned:async()=>true, ...overrides })
test('lost response becomes committed only after pinned bytes and second metadata read',async()=>{
  let reads=0, verified=0
  const result=await run({readMeta:async()=>{reads++;return reads===1?{revision:7}:committed},
    verifyPinned:async()=>{verified++;return true}})
  assert.equal(result.status,'committed');assert.equal(result.checks,2);assert.equal(reads,3);assert.equal(verified,1)
})
test('unchanged metadata remains unknown, never authorizes a repeated write',async()=>{
  let reads=0
  const result=await run({readMeta:async()=>{reads++;return {revision:7}}})
  assert.equal(result.status,'not-observed');assert.equal(reads,3);assert.equal('retry' in result,false)
})
test('read failure stays unknown',async()=>assert.equal((await run({readMeta:async()=>{throw Error('offline')}})).status,'read-unavailable'))
test('another payload or revision cannot acknowledge this commit',async()=>{
  for(const change of [{revision:9},{payloadSha256:'c'.repeat(64)},{logicalFingerprint:'d'.repeat(64)}])
    assert.equal((await run({readMeta:async()=>({...committed,...change})})).status,'different-revision')
})
test('metadata is insufficient when pinned byte verification fails',async()=>{
  assert.equal((await run({verifyPinned:async()=>false})).status,'readback-mismatch')
})
test('change during readback is not a stable commit proof',async()=>{
  let calls=0
  assert.equal((await run({readMeta:async()=>++calls===1?committed:{...committed,revision:9}})).status,'different-revision')
})
test('a later valid readback can settle a transient read failure without writing',async()=>{
  let calls=0
  assert.equal((await run({verifyPinned:async()=>{if(++calls===1)throw Error('lost GET');return true}})).status,'committed')
})
