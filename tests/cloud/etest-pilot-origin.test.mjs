import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isIsolatedEtestPilotOrigin as pilot } from
  '../../cloud-functions/_shared/etest-pilot-origin.js'
test('only exact HTTPS etest Maker origin may enable independent M1/M3 pilots',()=>{
  assert.equal(pilot('https://etest.edgeone.dev/api/sync/events/v2'),true)
  assert.equal(pilot('https://etest.edgeone.dev:443/api/health'),true)
  for(const url of [
    'https://q.smhe.cn/learn','https://qwerty-plus.edgeone.dev/',
    'https://q-test.edgeone.cool/learn','https://etest.edgeone.dev.evil.org/',
    'http://etest.edgeone.dev/','https://etest.edgeone.dev:8443/',
    'https://evil.org@q.smhe.cn/','https://smhe00.github.io/qwerty-learner/',
    'not-a-url','',
  ])assert.equal(pilot(url),false,url)
})
