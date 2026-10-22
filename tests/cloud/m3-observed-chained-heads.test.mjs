import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const root=fileURLToPath(new URL('../../',import.meta.url))
const dir=mkdtempSync(join(tmpdir(),'qwerty-head-discovery-'))
const output=join(dir,'heads.mjs')
await build({entryPoints:[resolve(root,'src/sync/m3-observed-chained-heads.ts')],
  outfile:output,bundle:true,platform:'node',format:'esm',
  target:'node20',tsconfig:resolve(root,'tsconfig.json')})
after(()=>rmSync(dir,{recursive:true,force:true}))
const {selectObservedChainedHeads:select}=await import(pathToFileURL(output).href)
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const device=n=>'qwerty-web-'+uuid(n)
const receipt=(d,sequence,n)=>({deviceId:device(d),sequence,
  batchId:uuid(n),sha256:String(n%10).repeat(64)})
const observed=values=>({observed:values,observedCount:values.length,
  visibleForks:[],visibleGaps:[],truncated:false,
  listingIsAuthoritative:false,convergenceComplete:false})
test('selects deterministic highest visible head for two independent devices',()=>{
  const a=receipt(1,1,11),b=receipt(1,2,12),c=receipt(2,1,13)
  const x=select(observed([c,b,a]))
  const y=select(observed([a,c,b]))
  assert.equal(x.status,'heads-observed-only')
  assert.deepEqual(x.heads,[b,c])
  assert.deepEqual(x.heads,y.heads)
  assert.equal(x.convergenceComplete,false)
  assert.equal(x.listingIsAuthoritative,false)
  assert.equal(x.publishReady,false)
})
test('eventually consistent hidden prefix is blocked, never declared converged',()=>{
  const x=select(observed([receipt(1,2,12)]))
  assert.equal(x.reason,'missing-visible-prefix')
  const y=select({...observed([receipt(1,1,11)]),visibleGaps:[device(2)+':1']})
  assert.equal(y.reason,'visible-fork-or-gap')
  assert.equal(select({...observed([receipt(1,1,11)]),truncated:true}).status,'blocked')
})
test('visible fork and forged same-sequence selector are rejected',()=>{
  const a=receipt(1,1,11),b=receipt(1,1,12)
  assert.equal(select(observed([a,b])).reason,'contradictory-device-prefix')
  assert.equal(select({...observed([a]),visibleForks:[device(1)+':1']}).reason,
    'visible-fork-or-gap')
})
test('over-limit devices and sequence budgets fail closed',()=>{
  assert.equal(select(observed([1,2,3,4,5].map(n=>receipt(n,1,n)))).reason,
    'too-many-observed-devices')
  assert.equal(select(observed([receipt(1,129,17)])).reason,
    'invalid-receipt-selector')
})
test('forged authoritative completion, empty, inconsistent count all block',()=>{
  const a=receipt(1,1,11)
  assert.equal(select(observed([])).status,'blocked')
  assert.equal(select({...observed([a]),listingIsAuthoritative:true}).status,'blocked')
  assert.equal(select({...observed([a]),convergenceComplete:true}).status,'blocked')
  assert.equal(select({...observed([a]),observedCount:2}).status,'blocked')
  assert.equal(select(observed([{...a,sha256:'bad'}])).status,'blocked')
})
