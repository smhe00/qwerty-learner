import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const root=fileURLToPath(new URL('../../',import.meta.url))
const dir=mkdtempSync(join(tmpdir(),'qwerty-chapter-conservation-'))
const outfile=join(dir,'chapter.mjs')
await build({entryPoints:[resolve(root,'src/sync/v4-chapter-record-three-way.ts')],
  outfile,bundle:true,platform:'node',format:'esm',target:'node20',
  tsconfig:resolve(root,'tsconfig.json')})
after(()=>rmSync(dir,{recursive:true,force:true}))
const {mergeUuidChapterRecords:merge}=await import(pathToFileURL(outfile).href)
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const word=(id,n,name)=>({id,attemptId:uuid(n),dict:'school',word:name,
  timeStamp:1800000000,chapter:0})
const chapter=(id,n,refs)=>({
  id,chapterRecordId:uuid(n),dict:'school',chapter:0,timeStamp:1800003600,
  time:10,correctCount:6,wrongCount:0,wordCount:1,
  correctWordIndexes:[0],wordNumber:1,wordRecordIds:refs,
})
function sample(){
  const original=chapter(1,10,[1])
  const base=word(1,1,'apple'),left=word(2,2,'banana')
  const right=word(2,3,'cherry')
  return {ancestor:[original],ancestorWords:[base],
    local:{chapters:[structuredClone(original),chapter(2,11,[2])],
      words:[base,left]},
    remote:{chapters:[structuredClone(original),chapter(2,12,[2])],
      words:[base,right]},
    candidateWords:[base,left,{...right,id:3}],
  }
}
test('two devices finish separate chapters using colliding numeric primary keys',()=>{
  const input=sample(),unchanged=structuredClone(input)
  const x=merge(input)
  assert.equal(x.status,'merged',x.reason)
  assert.deepEqual(x.rows.map(r=>r.id),[1,2,3])
  assert.deepEqual(x.rows.map(r=>r.wordRecordIds),[[1],[2],[3]])
  assert.deepEqual(input,unchanged)
  assert.equal(x.publishReady,false)
  const swapped=merge({...input,local:input.remote,remote:input.local})
  assert.deepEqual(swapped.rows,x.rows)
})
test('identical retransmitted chapter UUID deduplicates',()=>{
  const input=sample()
  input.remote.chapters[1]={...input.local.chapters[1]}
  input.remote.words=[...input.local.words]
  const x=merge(input)
  assert.equal(x.status,'merged',x.reason)
  assert.equal(x.rows.length,2)
})
test('contradictory same UUID from separate devices blocks',()=>{
  const input=sample()
  input.remote.chapters[1].chapterRecordId=uuid(11)
  assert.equal(merge(input).reason,'contradictory-chapter-uuid')
})
test('new legacy chapters, changed ancestor or disappearing chapter blocks',()=>{
  const a=sample()
  delete a.local.chapters[1].chapterRecordId
  assert.equal(merge(a).reason,'new-chapter-lacks-valid-immutable-identity')
  const b=sample()
  b.remote.chapters.shift()
  assert.equal(merge(b).reason,'ancestor-chapter-deleted-or-rewritten')
  const c=sample()
  c.local.chapters[0].time=12
  assert.equal(merge(c).reason,'ancestor-chapter-deleted-or-rewritten')
})
test('dangling or cross-device incorrect word numeric foreign key blocks',()=>{
  const a=sample()
  a.remote.chapters[1].wordRecordIds=[999]
  assert.equal(merge(a).reason,'dangling-source-word-reference')
  const b=sample()
  b.candidateWords[1].attemptId=uuid(90)
  assert.equal(merge(b).reason,'wrong-or-unmapped-merged-word-reference')
})
test('ancestor pre-UUID chapter is still byte-for-byte preserved',()=>{
  const a=sample()
  for(const rows of [a.ancestor,a.local.chapters,a.remote.chapters]){
    delete rows[0].chapterRecordId
  }
  const x=merge(a)
  assert.equal(x.status,'merged',x.reason)
  assert.deepEqual(x.rows[0],a.ancestor[0])
})
