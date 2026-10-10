/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { isS2WriteAllowed } from '../../cloud-functions/_shared/s2-write-gate.js'

test('S2 write gate fails closed without explicit account configuration', () => {
  for (const config of [undefined, null, '', ' ', '*', 'a,*', '*,a', 42]) {
    assert.equal(isS2WriteAllowed(config, 'a'), false)
  }
})

test('S2 write gate matches only exact immutable account IDs', () => {
  assert.equal(isS2WriteAllowed('id-a, id-b', 'id-a'), true)
  assert.equal(isS2WriteAllowed('id-a, id-b', 'id-b'), true)
  for (const id of ['id', 'id-c', 'ID-A', '', ' id-a ', 'id-a,id-b']) {
    assert.equal(isS2WriteAllowed('id-a, id-b', id), false)
  }
})

test('S2 write gate never recognizes wildcards as a production authorization', () => {
  assert.equal(isS2WriteAllowed('id-a,*,id-b', 'id-a'), false)
  assert.equal(isS2WriteAllowed('*', 'other'), false)
})
