/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { fixtureCleanupPolicySafe, newlyCreatedFixtureProtected } from './handoff-cleanup-preflight.mjs'
const serverTimeMs = Date.parse('2026-10-25T12:00:00Z')
const health = { serverTimeMs, capabilities: ['idle-auto-policy-v1'] }
const policy = { enabled: true, executionEnabled: true, idleDays: 180 }
test('handoff qualification permits bounded maintenance only with fresh server-issued fixture identity', () => {
  assert.equal(newlyCreatedFixtureProtected(health, policy, { createdAt: new Date(serverTimeMs).toISOString() }), true)
  assert.equal(fixtureCleanupPolicySafe(health, { ...policy, executionEnabled: false }), true)
  assert.equal(newlyCreatedFixtureProtected(health, policy, { createdAt: '2026-01-01' }), false)
  assert.equal(newlyCreatedFixtureProtected(health, policy, {}), false)
  assert.equal(newlyCreatedFixtureProtected({}, policy, { createdAt: new Date(serverTimeMs).toISOString() }), false)
  assert.equal(fixtureCleanupPolicySafe({ ...health, capabilities: [] }, policy), false)
  assert.equal(fixtureCleanupPolicySafe(health, { ...policy, idleDays: 1 }), false)
  assert.equal(fixtureCleanupPolicySafe(health, { ...policy, executionEnabled: undefined }), false)
})
