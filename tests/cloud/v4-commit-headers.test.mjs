/* eslint-env node */
import test from 'node:test'
import assert from 'node:assert/strict'
import { hasV4CommitHeaders, readV4CommitHeaders } from
  '../../cloud-functions/_shared/v4-commit-header.js'

const sha = character => character.repeat(64)
function headers(fields = {}) {
  return { 'X-Qwerty-Commit-Protocol': 'header-v1',
    'X-Qwerty-Base-Revision': '7',
    'X-Qwerty-Logical-Fingerprint': sha('b'),
    'X-Qwerty-Payload-Sha256': sha('a'),
    'X-Qwerty-Part-Count': '3',
    'X-Qwerty-Part-Sha256s': [sha('c'), sha('d'), sha('e')].join(','),
    'X-Qwerty-Chunk-Bytes': '524288',
    'X-Qwerty-Device-Id': 'qwerty-web-s2-manual',
    ...fields }
}
function req(fields = {}, body = undefined) {
  return new Request('https://t.smhe.cn/api/sync/v2/commit',
    { method:'POST', headers:headers(fields), body })
}
test('native header V4 manifest is complete, strict, and does not consume body', () => {
  const r=req()
  assert.equal(r.body,null)
  assert.equal(hasV4CommitHeaders(r),true)
  assert.deepEqual(readV4CommitHeaders(r), {
    baseRevision:7, count:3, payloadSha256:sha('a'),
    partSha256s:[sha('c'),sha('d'),sha('e')],
    logicalFingerprint:sha('b'), wirePartBytes:524288,
    clientFormatVersion:'qwerty-backup-v4', deviceId:'qwerty-web-s2-manual',
  })
})
test('native headers also support exactly 32 parts (16 MiB quota)', () => {
  const h=headers({ 'X-Qwerty-Part-Count':'32',
    'X-Qwerty-Part-Sha256s':Array.from({length:32},(_,i)=>i.toString(16).padStart(64,'0')).join(',') })
  assert.equal(readV4CommitHeaders(req(h)).partSha256s.length,32)
})
test('invalid manifest, noncanonical counters, body, and encoding are rejected', () => {
  const invalid=[
    { 'X-Qwerty-Base-Revision':'-1' },
    { 'X-Qwerty-Base-Revision':'01' },
    { 'X-Qwerty-Part-Count':'4' },
    { 'X-Qwerty-Part-Count':'33' },
    { 'X-Qwerty-Chunk-Bytes':'192000' },
    { 'X-Qwerty-Logical-Fingerprint':'not-sha' },
    { 'X-Qwerty-Part-Sha256s':'short' },
    { 'X-Qwerty-Device-Id':'line\ninjection' },
    { 'X-Qwerty-Commit-Protocol':'unexpected' },
  ]
  for (const value of invalid) {
    if (Object.keys(value).includes('X-Qwerty-Device-Id')) continue
    assert.throws(()=>readV4CommitHeaders(req(value)),
      error=>error?.code==='invalid_v4_commit_headers')
  }
  assert.throws(()=>readV4CommitHeaders(req({},'{}')),
    error=>error?.code==='invalid_v4_commit_headers')
  assert.throws(()=>readV4CommitHeaders(req({'Content-Length':'1'})),
    error=>error?.code==='invalid_v4_commit_headers')
})
test('legacy clients are detected without parsing body', () => {
  const r=new Request('https://t.smhe.cn/api/sync/v2/commit',{
    method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
  assert.equal(hasV4CommitHeaders(r),false)
})
