import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isIsolatedEtestPilotOrigin as diagnosticOrigin } from '../../cloud-functions/_shared/etest-pilot-origin.js'

// The event endpoints require live account authorization, not a Maker env or
// a potentially spoofable Origin/Host header. This URL utility is diagnostic.
test('etest URL is diagnostic only and cannot establish Maker project identity', () => {
  assert.equal(diagnosticOrigin('https://t.smhe.cn/api/sync/events/v2'), true)
  assert.equal(diagnosticOrigin('https://t.smhe.cn:443/api/health'), true)
  // Real Maker runtime request URL can be an internal qcloudteo host.
  assert.equal(diagnosticOrigin(
    'https://pages-pro-26-cfa3.pages-scf-sg-pro.qcloudteo.com/api/health'), false)
  for (const url of [
    'https://q.smhe.cn/learn', 'https://qwerty-plus.edgeone.dev/',
    'https://t.smhe.cn.evil.org/', 'http://t.smhe.cn/',
    'https://t.smhe.cn:8443/', 'https://evil.org@q.smhe.cn/',
    'https://smhe00.github.io/qwerty-learner/', 'not-a-url', '',
  ]) assert.equal(diagnosticOrigin(url), false, url)
})
