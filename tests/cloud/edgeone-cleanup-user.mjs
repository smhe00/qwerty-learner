/* eslint-env node */
import { getStore } from '@edgeone/pages-blob'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'

const username = String(process.env.QWERTY_E2E_USERNAME || '').trim()
const projectId = String(process.env.EDGEONE_PROJECT_ID || '').trim()
const token = String(process.env.EDGEONE_API_TOKEN || '').trim()
const storeName = String(process.env.BLOB_STORE_NAME || 'qwerty-data').trim()

if (!username) throw new Error('QWERTY_E2E_USERNAME is required')
if (!projectId) throw new Error('EDGEONE_PROJECT_ID is required')
if (!token) throw new Error('EDGEONE_API_TOKEN is required')

const store = getStore({
  name: storeName,
  projectId,
  token,
  consistency: 'strong',
})

const service = createBackendService({
  storage: createEdgeOneBlobStorage(store),
})

const cleanupResult = await service.cleanupTestUser(username)
console.log('EdgeOne browser E2E cleanup:', cleanupResult)
