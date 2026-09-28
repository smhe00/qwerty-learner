/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { getStore } from '@edgeone/pages-blob'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'

const baseUrl = String(process.env.QWERTY_SYNC_BASE_URL || '').replace(/\/+$/, '')
const projectId = process.env.EDGEONE_PROJECT_ID || ''
const apiToken = process.env.EDGEONE_API_TOKEN || ''
const storeName = process.env.BLOB_STORE_NAME || 'qwerty-data'

if (!baseUrl) throw new Error('QWERTY_SYNC_BASE_URL is required')
if (!projectId) throw new Error('EDGEONE_PROJECT_ID is required for real-Blob verification/cleanup')
if (!apiToken) throw new Error('EDGEONE_API_TOKEN is required for real-Blob verification/cleanup')

const store = getStore({
  name: storeName,
  projectId,
  token: apiToken,
  consistency: 'strong',
})
const storage = createEdgeOneBlobStorage(store)
const cleanupService = createBackendService({ storage })

const username = `edgeone_test_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`
const password = `EdgeOne-Test-A9-${crypto.randomBytes(8).toString('hex')}`
let userId = null

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' }

  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  let json

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new Error(
      `${method} ${path} returned non-JSON HTTP ${response.status}: ${text.slice(0, 300)}`,
    )
  }

  return { status: response.status, json }
}

function payload(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

function revisionFromKey(key) {
  const match = /\/(\d{12})\.json$/.exec(key)
  return match ? Number(match[1]) : null
}

try {
  const health = await request('/api/health')
  assert.equal(health.status, 200)
  assert.equal(health.json?.ok, true)
  assert.equal(health.json?.authMode, 'single-active-session')

  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username,
      password,
      deviceId: 'edgeone-live-register',
    },
  })

  assert.equal(registered.status, 201)
  assert.equal(registered.json?.ok, true)
  assert.ok(registered.json?.token)
  userId = registered.json.user.userId

  const registerToken = registered.json.token

  const meRegistered = await request('/api/auth/me', { token: registerToken })
  assert.equal(meRegistered.status, 200)

  const firstLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      username,
      password,
      deviceId: 'edgeone-live-a',
    },
  })

  assert.equal(firstLogin.status, 200)
  const firstLoginToken = firstLogin.json.token

  const revokedRegistration = await request('/api/auth/me', { token: registerToken })
  assert.equal(revokedRegistration.status, 401)
  assert.equal(revokedRegistration.json?.error, 'session_revoked')

  const secondLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      username,
      password,
      deviceId: 'edgeone-live-b',
    },
  })

  assert.equal(secondLogin.status, 200)
  const activeToken = secondLogin.json.token

  const revokedFirstLogin = await request('/api/auth/me', { token: firstLoginToken })
  assert.equal(revokedFirstLogin.status, 401)
  assert.equal(revokedFirstLogin.json?.error, 'session_revoked')

  const meta0 = await request('/api/sync/meta', { token: activeToken })
  assert.equal(meta0.status, 200)
  assert.equal(meta0.json?.revision, 0)

  let baseRevision = 0
  let latestPayload = null

  for (let revision = 1; revision <= 6; revision += 1) {
    latestPayload = payload({
      revision,
      source: 'edgeone-live-integration',
      value: `snapshot-${revision}`,
    })

    const uploaded = await request('/api/sync', {
      method: 'PUT',
      token: activeToken,
      body: {
        baseRevision,
        payloadBase64: latestPayload,
        deviceId: 'edgeone-live-b',
        clientFormatVersion: 'integration-v1',
      },
    })

    assert.equal(uploaded.status, 200)
    assert.equal(uploaded.json?.revision, revision)
    baseRevision = revision
  }

  const stale = await request('/api/sync', {
    method: 'PUT',
    token: activeToken,
    body: {
      baseRevision: 5,
      payloadBase64: payload({ stale: true }),
      deviceId: 'edgeone-live-b',
      clientFormatVersion: 'integration-v1',
    },
  })

  assert.equal(stale.status, 409)
  assert.equal(stale.json?.error, 'sync_conflict')

  const downloaded = await request('/api/sync', { token: activeToken })
  assert.equal(downloaded.status, 200)
  assert.equal(downloaded.json?.revision, 6)
  assert.equal(downloaded.json?.payloadBase64, latestPayload)

  const { blobs = [] } = await store.list({
    prefix: `users/${userId}/revisions/`,
    consistency: 'strong',
  })

  const retainedRevisions = blobs
    .map((blob) => revisionFromKey(blob.key))
    .filter((revision) => revision !== null)
    .sort((left, right) => left - right)

  assert.deepEqual(retainedRevisions, [4, 5, 6])

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        userId,
        retainedRevisions,
        latestRevision: 6,
        singleActiveSession: true,
      },
      null,
      2,
    ),
  )
} finally {
  try {
    const cleanup = await cleanupService.cleanupTestUser(username)
    console.log('EdgeOne integration cleanup:', cleanup)
  } catch (error) {
    console.error('EdgeOne integration cleanup failed:', error)
    process.exitCode = 1
  }
}
