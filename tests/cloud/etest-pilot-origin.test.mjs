import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isIsolatedEtestPilotOrigin as diagnosticOrigin,
  isImmutableEventPilotEnabled,
} from '../../cloud-functions/_shared/etest-pilot-origin.js'

test('Maker project environment is the ONLY authorization for immutable events', () => {
  assert.equal(isImmutableEventPilotEnabled(undefined), false)
  for (const env of [
    {}, { MULTI_DEVICE_EVENT_PILOT_ENABLED: 'false' },
    { MULTI_DEVICE_EVENT_PILOT_ENABLED: true },
    { MULTI_DEVICE_EVENT_PILOT_ENABLED: 'TRUE' },
    { MULTI_DEVICE_AUTH_ENABLED: 'true' },
    { ORIGIN: 'https://etest.edgeone.dev' },
    { HOST: 'etest.edgeone.dev' },
    { FORWARDED_HOST: 'etest.edgeone.dev' },
    { MULTI_DEVICE_EVENT_PILOT_ENABLED: 'false',
      HOST: 'etest.edgeone.dev' },
  ]) {
    assert.equal(isImmutableEventPilotEnabled(env), false, JSON.stringify(env))
  }
  assert.equal(isImmutableEventPilotEnabled({
    MULTI_DEVICE_EVENT_PILOT_ENABLED: 'true',
  }), true)
  assert.equal(isImmutableEventPilotEnabled({
    MULTI_DEVICE_EVENT_PILOT_ENABLED: 'true',
    HOST: 'q.smhe.cn',
  }), true, 'the Maker project env, not a client header, determines pilot')
})

test('etest URL is diagnostic only and cannot establish Maker project identity', () => {
  assert.equal(diagnosticOrigin('https://etest.edgeone.dev/api/sync/events/v2'), true)
  assert.equal(diagnosticOrigin('https://etest.edgeone.dev:443/api/health'), true)
  // Real Maker runtime request URL can be an internal qcloudteo host.
  assert.equal(diagnosticOrigin(
    'https://pages-pro-26-cfa3.pages-scf-sg-pro.qcloudteo.com/api/health'), false)
  for (const url of [
    'https://q.smhe.cn/learn', 'https://qwerty-plus.edgeone.dev/',
    'https://etest.edgeone.dev.evil.org/', 'http://etest.edgeone.dev/',
    'https://etest.edgeone.dev:8443/', 'https://evil.org@q.smhe.cn/',
    'https://smhe00.github.io/qwerty-learner/', 'not-a-url', '',
  ]) assert.equal(diagnosticOrigin(url), false, url)
})
