import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { assessSongArtAccess } = await import(pathToFileURL('/tmp/qwerty-song-access.mjs').href)
const now=Math.floor(Date.now()/1000)
const before=offset=>{
  const date=new Date(now*1000)
  date.setHours(0,1,0,0)
  date.setDate(date.getDate()-offset)
  return Math.floor(date.getTime()/1000)
}
const records=(offsets,mode='learn')=>offsets.map(offset=>({
  sourceMode:mode,timeStamp:before(offset),
}))
assert.deepEqual(assessSongArtAccess([],now),{eligible:false,activeDays:0,bestStreak:0})
assert.equal(assessSongArtAccess(records([2,1,0],'typing'),now).eligible,false)
assert.equal(assessSongArtAccess(records([2,1]),now).eligible,false)
assert.equal(assessSongArtAccess(records([0,2,4]),now).eligible,false)
assert.equal(assessSongArtAccess(records([0,0,0]),now).eligible,false)
assert.deepEqual(assessSongArtAccess(records([2,1,0]),now),{eligible:true,activeDays:3,bestStreak:3})
assert.equal(assessSongArtAccess(records([18,17,16,0]),now).eligible,true,
  'Previously earned access must never be revoked by a later break')
assert.equal(assessSongArtAccess([...records([2,1]),{sourceMode:'learn',timeStamp:now+3600}],now).eligible,false)
assert.equal(assessSongArtAccess([...records([2,1,0]),{sourceMode:'learn',timeStamp:NaN}],now).eligible,true)
console.log('PASS Focus remains default; optional Song art only qualifies after three consecutive Learn dates.')
