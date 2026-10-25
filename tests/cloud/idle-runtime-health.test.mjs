/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequestGet } from '../../cloud-functions/api/idle-runtime-health.js'

test('method-specific probe returns only binding types/booleans and known server region', async () => {
  const env = { IDLE_POLICY_START_AT: '2026-10-25T04:14:59.438Z', IDLE_CLEANUP_EXECUTE: 'false' }
  Object.defineProperty(env, 'ADMIN_PASSWORD', { get() { throw Error('Password must not be accessed') } })
  const response = await onRequestGet({ env, server: { region: 'ap-singapore' } })
  const text = await response.text()
  const body = JSON.parse(text)
  assert.equal(body.context.dateValid, true)
  assert.equal(body.context.executionRequested, false)
  assert.equal(body.functionRegion, 'ap-singapore')
  assert.equal(text.includes(env.IDLE_POLICY_START_AT), false)
  assert.equal(text.includes('ADMIN_PASSWORD'), false)
})
test('map-shaped configuration is observed without reading any password or user data', async () => {
  const keys = []
  const env = { get: async key => { keys.push(key); return key === 'IDLE_POLICY_START_AT' ? '2026-10-25T00:00:00Z' : 'false' } }
  const response = await onRequestGet({ env, server: { region: 'unknown-private-value' } })
  const body = await response.json()
  assert.equal(body.context.mapRead, 'observed')
  assert.equal(body.context.mappedDateValid, true)
  assert.equal(body.context.mappedExecutionRequested, false)
  assert.equal(body.functionRegion, 'not-reported')
  assert.deepEqual(keys, ['IDLE_POLICY_START_AT', 'IDLE_CLEANUP_EXECUTE'])
})
