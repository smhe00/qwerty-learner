import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const root=fileURLToPath(new URL('../../',import.meta.url))
const dir=mkdtempSync(join(tmpdir(),'qwerty-achievement-identity-'))
const outfile=join(dir,'identity.mjs')
await build({entryPoints:[resolve(root,'src/achievement/attempt-event-id.ts')],
  outfile,bundle:true,platform:'node',format:'esm',target:'node20',
  tsconfig:resolve(root,'tsconfig.json')})
after(()=>rmSync(dir,{recursive:true,force:true}))
const {achievementAttemptEventIds:ids}=await import(pathToFileURL(outfile).href)
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
test('independent devices sharing local numeric WordRecord ID never share event ID',()=>{
  const a=ids('word',12,{attemptId:uuid(1)})
  const b=ids('word',12,{attemptId:uuid(2)})
  assert.notEqual(a.primary,b.primary)
  assert.equal(a.primary,'word:'+uuid(1))
  assert.deepEqual(a.all,['word:'+uuid(1),'word:12'])
  assert.deepEqual(b.all,['word:'+uuid(2),'word:12'])
})
test('legacy numeric-key events remain discoverable without historical backfill',()=>{
  assert.deepEqual(ids('word',7,{}),{primary:'word:7',all:['word:7']})
  assert.deepEqual(ids('mastery',7,{}),{primary:'mastery:7',all:['mastery:7']})
})
test('mastery follows the same stable UUID and never conflates with word attempt',()=>{
  const word=ids('word',2,{attemptId:uuid(3)})
  const mastery=ids('mastery',2,{attemptId:uuid(3)})
  assert.notEqual(word.primary,mastery.primary)
  assert.equal(mastery.primary,'mastery:'+uuid(3))
})
test('invalid numeric and invalid nonlegacy UUID fail closed',()=>{
  assert.throws(()=>ids('word',0,{attemptId:uuid(1)}),/numeric/)
  assert.throws(()=>ids('word',1,{attemptId:'not-a-uuid'}),/immutable/)
})
