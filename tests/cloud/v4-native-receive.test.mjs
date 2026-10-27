/* eslint-env node */
import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const hash = data => crypto.createHash('sha256').update(data).digest('hex')
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}'
}
async function fixture() {
  const objects = new Map()
  let lookupStarted = false
  globalThis.__v4NativeReceiveStore = {
    async get(key) { lookupStarted = true; await Promise.resolve(); return structuredClone(objects.get(key) ?? null) },
    async setJSON(key, value) { objects.set(key, structuredClone(value)) },
    async set(key, value) { objects.set(key, value.slice(0)) },
    async delete(key) { objects.delete(key) },
    async list({ prefix }) { return { blobs: [...objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) } },
  }
  const built = await build({ entryPoints: ['cloud-functions/api/[[default]].js'], bundle: true,
    platform: 'node', target: 'node20', format: 'esm', write: false,
    plugins: [{ name: 'native-receive', setup(b) {
      b.onResolve({ filter: /^@edgeone\/pages-blob$/ }, () => ({ path: 'store', namespace: 'native-receive' }))
      b.onLoad({ filter: /.*/, namespace: 'native-receive' }, () => ({
        contents: 'export const getStore = () => globalThis.__v4NativeReceiveStore',
      }))
    } }],
  })
  const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
  const env = { branch: 'etest', AUTH_RATE_LIMIT_REQUESTS: '1000', IDLE_CLEANUP_EXECUTE: 'false' }
  const result = await onRequest({ env, clientIp: '192.0.2.120', request: new Request('https://internal.invalid/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'native_v4_receive', password: 'synthetic-password' }),
  }) })
  assert.equal(result.status, 201)
  const account = await result.json()
  const send = async ({ path = '/sync/v2/parts', branch = 'etest', data = Buffer.from('abc'), headers = {},
    token = account.token, receiveError, allowLateRead = false, overrides = {} } = {}) => {
    lookupStarted = false
    let reads = 0
    const request = new Request('https://internal.invalid/api' + path, {
      method: 'POST', headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        'content-type': 'application/octet-stream', 'content-length': String(data.length),
        'x-qwerty-chunk-bytes': '524288', 'x-qwerty-part-index': '0', 'x-qwerty-part-count': '1',
        'x-qwerty-payload-sha256': hash(data), 'x-qwerty-part-sha256': hash(data),
        'x-qwerty-base-revision': '0', 'x-qwerty-logical-fingerprint': 'c'.repeat(64), ...headers,
      }, body: data,
    })
    const native = request.arrayBuffer.bind(request)
    request.arrayBuffer = () => {
      reads++
      if (receiveError) return Promise.reject(receiveError)
      if (lookupStarted && !allowLateRead) throw new TypeError('Synthetic native body lifetime expired')
      return native()
    }
    request.clone = () => { throw Error('Must not clone native request') }
    request.text = () => { throw Error('Must not use text receive') }
    Object.defineProperty(request, 'body', { get() { throw Error('Native stream access unavailable') } })
    const response = await onRequest({ request, env: { ...env, branch, ...overrides },
      clientIp: '192.0.2.120', uuid: 'receive-fixture-123' })
    return { status: response.status, body: await response.json(), reads }
  }
  return { account, objects, send }
}
function snapshot(accountId) {
  const names = ['achievementEvents', 'achievementStates', 'chapterRecords', 'reviewRecords', 'reviewWordStates', 'wordRecords']
  const tables = names.map(name => ({ name, schema: '++id' }))
  const data = names.map(tableName => ({ tableName, inbound: true, rows: [] }))
  const learnRuntime = { dailySessions: {} }, settings = { version: 1, values: {} }, navigation = { currentDict: 'test', currentChapter: 0 }
  const bytes = gzipSync(Buffer.from(JSON.stringify({
    backupFormatVersion: 'qwerty-backup-v4',
    metadata: { createdAt: '2026-10-27T00:00:00Z', source: { kind: 'account', accountId } },
    workspaceData: { database: { formatName: 'dexie', formatVersion: 1, data: {
      databaseName: 'RecordDB', databaseVersion: 6, tables, data,
    } }, learnRuntime, settings, navigation },
  })))
  return { bytes, fingerprint: hash(stable({ database: { tables, data }, learnRuntime, settings, navigation })) }
}
for (const branch of ['etest', 'master']) {
  test(branch + ' receives native parts and direct V4 before async guards, once, with real validation and storage', async () => {
    const f = await fixture()
    const bytes = crypto.randomBytes(512 * 1024)
    const part = await f.send({ branch, data: bytes })
    assert.equal(part.status, 200, JSON.stringify(part.body))
    assert.equal(part.reads, 1)
    const staged = [...f.objects.entries()].filter(([key]) => key.includes('/v4-http-parts/'))
    assert.equal(staged.length, 1)
    assert.ok(Buffer.from(staged[0][1]).equals(bytes))
    const v4 = snapshot(f.account.user.userId)
    const direct = await f.send({ branch, path: '/sync/v2/binary/direct', data: v4.bytes,
      headers: { 'x-qwerty-logical-fingerprint': v4.fingerprint } })
    assert.equal(direct.status, 200, JSON.stringify(direct.body))
    assert.equal(direct.body.revision, 1)
    assert.equal(direct.reads, 1)
  })
}
test('early receiving cannot bypass authentication, suspension, length, quota or digest checks', async () => {
  const f = await fixture()
  for (const path of ['/sync/v2/parts', '/sync/v2/binary/direct']) {
    for (const token of [null, 'revoked']) {
      const r = await f.send({ path, token, receiveError: new Error('PRIVATE') })
      assert.equal(r.status, 401)
      assert.equal(r.reads, 1)
      assert.ok(!JSON.stringify(r.body).includes('PRIVATE'))
    }
    assert.equal((await f.send({ path, overrides: { S2_SYNC_WRITES_DISABLED: 'true' } })).body.error, 's2_writes_temporarily_disabled')
    const tooLarge = await f.send({ path, headers: { 'content-length': '524289' } })
    assert.equal(tooLarge.status, 413)
    assert.equal(tooLarge.reads, 0)
    assert.equal((await f.send({ path, data: Buffer.alloc(524289), headers: { 'content-length': '3' } })).status, 413)
    assert.equal((await f.send({ path, data: Buffer.alloc(0) })).status, 413)
    assert.equal((await f.send({ path, headers: { 'content-length': '2' } })).status, 400)
    const badHash = await f.send({ path, headers: { 'x-qwerty-part-sha256': 'f'.repeat(64), 'x-qwerty-payload-sha256': 'f'.repeat(64) } })
    assert.equal(badHash.status, 400)
    assert.ok(badHash.body.error.endsWith('sha_mismatch'))
  }
  assert.equal([...f.objects.keys()].some(k => k.includes('/v4-http-parts/') || k.includes('/v4/revisions/')), false)
})
test('receive errors retain bounded cause diagnostics in response and log without secrets or a retry', async () => {
  const f = await fixture()
  const messages = []
  const original = console.error
  console.error = value => messages.push(value)
  try {
    for (const path of ['/sync/v2/parts', '/sync/v2/binary/direct']) {
      for (const [error, name, code] of [
        [new TypeError('PRIVATE_BODY_AND_TOKEN', { cause: Object.assign(new Error('PRIVATE_KEY'), { code: 'ECONNRESET' }) }), 'TypeError', 'ECONNRESET'],
        [new DOMException('PRIVATE', 'AbortError'), 'AbortError', null],
        [Object.assign(new Error('PRIVATE'), { name: 'PRIVATE_NAME', code: 'PRIVATE_CODE' }), 'UnknownError', null],
      ]) {
        const r = await f.send({ path, receiveError: error })
        assert.equal(r.status, 503)
        assert.equal(r.reads, 1)
        assert.equal(r.body.error, path.endsWith('direct') ? 'v4_direct_body_read_failed' : 'v4_upload_body_read_failed')
        assert.equal(r.body.requestId, 'receive-fixture-123')
        assert.equal(r.body.details.failureStage, 'request-body')
        assert.equal(r.body.details.receive.errorName, name)
        assert.equal(r.body.details.receive.errorCode, code)
        assert.equal(r.body.details.receive.declaredBytes, 3)
        assert.equal(r.body.details.receive.bodyUsedBefore, false)
        assert.equal(r.body.details.receive.abortedAfter, false)
        assert.ok(Number.isFinite(r.body.details.receive.elapsedMs))
        assert.equal(JSON.parse(messages.at(-1)).receive.errorName, name)
        assert.ok(!JSON.stringify([r.body, messages]).includes('PRIVATE'))
      }
    }
    assert.equal([...f.objects.keys()].some(k => k.includes('/v4-http-parts/')), false)
  } finally { console.error = original }
})
