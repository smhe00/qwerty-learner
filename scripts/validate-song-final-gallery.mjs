#!/usr/bin/env node
// Verify all 34 images exist and final six match RIFF+SHA and real catalog.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync,readdirSync } from 'node:fs'
import path from 'node:path'
const root='public/assets/achievements/song'
const catalog=JSON.parse(readFileSync('src/resources/achievementCulture/achievements.json','utf8'))
const manifest=JSON.parse(readFileSync('docs/design/achievement-song-collection/assets/Final-Six-20261017.json','utf8'))
const code=readFileSync('src/achievement/visual-assets/finalBatch.ts','utf8')
const preview=readFileSync('src/song-complete/entry.tsx','utf8')
assert.equal(catalog.length,34)
assert.equal(manifest.entries.length,6)
assert.equal(new Set(manifest.entries.map(x=>x.id)).size,6)
assert.deepEqual(readdirSync(path.join(root,'final-batch')).filter(x=>x.endsWith('.webp')).sort(),
  manifest.entries.map(x=>x.artFile).sort())
const have=new Set()
for(const batch of ['first-batch','second-batch','third-batch','final-batch']){
  for(const name of readdirSync(path.join(root,batch)).filter(x=>x.endsWith('.webp'))){
    assert.ok(!have.has(name),'duplicate art ID '+name)
    have.add(name)
  }
}
assert.equal(have.size,34)
for(const a of catalog) assert.ok(have.has(a.id+'.webp'),'missing '+a.id)
for(const a of manifest.entries){
 const real=catalog.find(x=>x.id===a.id)
 assert.ok(real,'unknown achievement '+a.id)
 assert.equal(a.title,real.title,a.id+' title')
 assert.equal(a.rarity,real.rarity,a.id+' rarity')
 assert.equal(a.rollout,real.presentation.rollout,a.id+' rollout')
 assert.equal(a.hidden,real.hidden,a.id+' hidden')
 assert.ok(code.includes("'"+a.id+"'"),a.id+' not whitelisted')
 const image=readFileSync(path.join(root,'final-batch',a.artFile))
 assert.equal(image.toString('ascii',0,4),'RIFF',a.id)
 assert.equal(image.toString('ascii',8,12),'WEBP',a.id)
 assert.equal(image.readUInt32LE(4)+8,image.length,a.id+' damaged WebP')
 assert.equal(image.length,a.sizeBytes,a.id+' file length')
 assert.equal(createHash('sha256').update(image).digest('hex'),a.sha256,a.id+' hash')
 assert.ok(image.length < 160*1024,a.id+' oversized')
 console.log('PASS '+a.id+' '+(image.length/1024).toFixed(1)+'KiB')
}
// Reject data-writing module imports, ignoring explanatory comments.
const importLines=preview.split('\\n').filter(line=>line.trimStart().startsWith('import '))
for(const forbidden of ['@/utils/db','@/achievement/repository','@/pages/Learn']) {
 assert.ok(!importLines.some(line=>line.includes(forbidden)),'unsafe museum import '+forbidden)
}
for(const forbidden of ['localStorage.setItem','indexedDB.open','markAchievementCultureCardSeen']) {
 assert.ok(!preview.includes(forbidden),'unsafe persistence API '+forbidden)
}
assert.ok(preview.includes('data-showcase-all-unlocked="true"'))
assert.ok(preview.includes('all.length !== 34'))
console.log('PASS six final pictures, all 34 IDs unique, pure showcase checked')
