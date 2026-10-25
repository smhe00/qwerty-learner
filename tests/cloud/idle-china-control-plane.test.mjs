/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { chinaControlPlaneFailure, chinaMakers } from '../../scripts/idle-china-control-plane.mjs'

test('every new verification client explicitly selects China without changing credentials', () => {
  const supplied = []
  class Makers { constructor(options) { supplied.push(options) } }
  chinaMakers(Makers, 'private-fixture-token')
  assert.deepEqual(supplied, [{ token: 'private-fixture-token', region: 'china' }])
  for (const token of ['', undefined, null]) assert.throws(() => chinaMakers(Makers, token))
  assert.equal(supplied.length, 1)
})
test('a China authentication failure never creates a global client or exposes private text', async () => {
  const attempts = []
  class Makers {
    constructor(options) {
      attempts.push(options.region)
      this.projects = { list: async () => { throw Object.assign(Error('private fixture secret'), { code: '109' }) } }
    }
  }
  const client = chinaMakers(Makers, 'private-fixture-token')
  let diagnostic
  try { await client.projects.list() } catch (error) { diagnostic = chinaControlPlaneFailure(error) }
  assert.deepEqual(attempts, ['china'])
  assert.deepEqual(diagnostic, { controlPlaneRegion: 'china', providerCode: '109', authenticationRejected: true,
    reason: 'china-control-plane-authentication-rejected' })
  assert.equal(JSON.stringify(diagnostic).includes('private'), false)
})
test('unknown failures remain unclassified instead of claiming authentication or serializing payloads', () => {
  const result = chinaControlPlaneFailure({ code: 'not safe/private', message: 'private', body: { token: 'private' } })
  assert.equal(result.providerCode, 'unspecified')
  assert.equal(result.authenticationRejected, false)
  assert.equal(JSON.stringify(result).includes('private'), false)
})
