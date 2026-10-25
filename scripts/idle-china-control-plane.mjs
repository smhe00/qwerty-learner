/* eslint-env node */
import assert from 'node:assert/strict'

// Owner confirmed both live sites belong to the China console. SDK automatic
// region detection can silently fall back to unrelated global-account projects.
export function chinaMakers(Makers, token) {
  assert.equal(typeof token, 'string')
  assert.ok(token.length > 0, 'China control-plane credential is missing')
  return new Makers({ token, region: 'china' })
}

export function chinaControlPlaneFailure(error) {
  const providerCode = typeof error?.code === 'string' && /^-?[A-Za-z0-9][A-Za-z0-9_.]{0,80}$/.test(error.code)
    ? error.code : 'unspecified'
  const authenticationRejected = ['105', '109'].includes(providerCode) || error?.name === 'AuthError'
  return { controlPlaneRegion: 'china', providerCode, authenticationRejected,
    reason: authenticationRejected ? 'china-control-plane-authentication-rejected' : 'china-control-plane-discovery-unavailable-or-not-unique' }
}
