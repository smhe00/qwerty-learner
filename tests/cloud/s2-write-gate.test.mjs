/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { isS2WriteEnabled } from '../../cloud-functions/_shared/s2-write-gate.js'

test('S2 GA enables V4 writes by default, without per-account authorization', () => {
  for (const value of [undefined, null, '', 'false', '0', 'no', 0, false, 'not-set']) {
    assert.equal(isS2WriteEnabled(value), true)
  }
})

test('S2 emergency global kill switch disables both ordinary V4 and recovery writes', () => {
  for (const value of [true, 1, 'true', 'TRUE', ' True ', '1', 'on', 'yes']) {
    assert.equal(isS2WriteEnabled(value), false)
  }
})

test('S2 access is never based on usernames, IDs, or a legacy wildcard', () => {
  // The only input is the global disabled flag, not a per-account ACL.
  assert.equal(isS2WriteEnabled(undefined), true)
  assert.equal(isS2WriteEnabled('id-a,id-b,*'), true)
})
