/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from '../../cloud-functions/api/[[default]].js'

function preflight(origin, env = {}) {
  const request = new Request('https://qwerty.example/api/auth/login', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
    },
  })

  return onRequest({ request, env })
}

test('CORS defaults to same-origin', async () => {
  const same = await preflight('https://qwerty.example')
  assert.equal(same.status, 204)
  assert.equal(
    same.headers.get('access-control-allow-origin'),
    'https://qwerty.example',
  )
  assert.equal(same.headers.get('vary'), 'Origin')

  const cross = await preflight('https://cross-origin.invalid')
  assert.equal(cross.status, 204)
  assert.equal(cross.headers.get('access-control-allow-origin'), null)
})

test('CORS supports an explicit origin allowlist', async () => {
  const allowed = await preflight('https://app.example', {
    CORS_ORIGIN: 'https://app.example,https://backup.example',
  })
  assert.equal(
    allowed.headers.get('access-control-allow-origin'),
    'https://app.example',
  )

  const denied = await preflight('https://other.example', {
    CORS_ORIGIN: 'https://app.example,https://backup.example',
  })
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
})

test('CORS wildcard remains available only when explicitly configured', async () => {
  const response = await preflight('https://cross-origin.invalid', {
    CORS_ORIGIN: '*',
  })
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
})
