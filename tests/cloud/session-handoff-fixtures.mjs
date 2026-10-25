/* eslint-env node */
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { createBackendService } from '../../cloud-functions/_shared/core.js'
import { createEdgeOneBlobStorage } from '../../cloud-functions/_shared/storage/edgeone-blob.js'
import { createSessionHandoffBarrier } from '../../cloud-functions/_shared/session-handoff-barrier.js'
import { AtomicTestStore, deferred } from './session-handoff-test-store.mjs'

// Exact production service + exact Blob adapter; only provider I/O is fake.
// Intentionally IGNORE onlyIfNew: this suite must not invent atomic Blob CAS.
export class PausableBlob {
  data = new Map()
  pause = null
  armManifestPause() {
    const reached = deferred(), release = deferred()
    this.pause = { reached, release }
    return this.pause
  }
  async setJSON(key, value) {
    if (this.pause && /\/revisions\/\d+\.json$/.test(key)) {
      const pause = this.pause
      this.pause = null
      pause.reached.resolve()
      await pause.release.promise
    }
    this.data.set(key, structuredClone(value))
  }
  async set(key, value) { this.data.set(key, Buffer.from(value)) }
  async get(key, { type } = {}) {
    const value = this.data.get(key)
    if (value === undefined) return null
    if (type === 'arrayBuffer') {
      const bytes = Buffer.from(value)
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    }
    return structuredClone(value)
  }
  async list({ prefix }) {
    return { blobs: [...this.data.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }
  }
  async delete(key) { this.data.delete(key) }
}

const tables = ['wordRecords', 'chapterRecords', 'reviewRecords',
  'reviewWordStates', 'achievementEvents', 'achievementStates']
const stable = value => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
const sha = value => crypto.createHash('sha256').update(value).digest('hex')

export function fixture(accountId, word, baseRevision = 0) {
  const database = { data: {
    tables: tables.map(name => ({ name })),
    data: tables.map(tableName => ({ tableName,
      rows: tableName === 'wordRecords' ? (Array.isArray(word) ? word : [word]).map((value, index) => ({ word: value, dict: 'handoff-fixture', timeStamp: index + 1 })) : [] })),
  } }
  const data = { database, learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: 'handoff-fixture', currentChapter: 0 } }
  const canonical = { ...data, database: {
    tables: [...database.data.tables].sort((a, b) => stable(a.name).localeCompare(stable(b.name))),
    data: database.data.data.map(entry => ({ ...entry, rows: [...entry.rows].sort((a, b) => stable(a).localeCompare(stable(b))) })).sort((a, b) => stable(a.tableName).localeCompare(stable(b.tableName))),
  } }
  const payloadBytes = gzipSync(Buffer.from(JSON.stringify({
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-25T00:00:00Z', source: { kind: 'account', accountId } },
    workspaceData: data,
  })))
  return { baseRevision, clientFormatVersion: 'qwerty-backup-v4',
    logicalFingerprint: sha(stable(canonical)), payloadBytes, deviceId: Array.isArray(word) ? 'handoff-fixture' : word }
}

export async function harness({ storageDecorator = storage => storage,
  options = {}, coordinator = new AtomicTestStore(), gateOptions = {},
  gateDecorator = gate => gate } = {}) {
  const blob = new PausableBlob()
  const storage = storageDecorator(createEdgeOneBlobStorage(blob))
  const plain = createBackendService({ storage })
  const username = `handoff-${crypto.randomBytes(6).toString('hex')}`
  const password = 'synthetic-test-only'
  const first = await plain.register(username, password, 'device-A')
  const make = () => createBackendService({ storage, ...options,
    handoffBarrier: gateDecorator(createSessionHandoffBarrier({
      store: coordinator, namespace: 'service-integration', pollMs: 1, ...gateOptions,
    })) })
  return { blob, storage, coordinator, a: make(), b: make(), make, plain,
    username, password, first, accountHash: sha(username) }
}
