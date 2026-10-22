import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'qwerty-daily-three-way-'))
const out = join(dir, 'policy.mjs')
await build({ entryPoints: [resolve(root, 'src/sync/v4-daily-session-three-way.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm',
  target: 'node20', tsconfig: resolve(root, 'tsconfig.json') })
after(() => rmSync(dir, { recursive: true, force: true }))
const { mergeDailySessionsThreeWay: merge } =
  await import(pathToFileURL(out).href)
const session = (dict, id = 'session-1') => ({
  version: 1, dict, sessionId: id, dateKey: '2026-10-22',
  startedAt: 1800000000, status: 'active', dailyNewTarget: 20,
  plannedNewWords: 20, plannedReviewWords: [], carryOverAcquisitionWords: [],
  accumulatedActiveSeconds: 0, completedBlockIds: [], blockCount: 0,
})
const runtime = dailySessions => ({ dailySessions })
test('independent dictionary cohorts merge without changing caller snapshots', () => {
  const a=runtime({}), l=runtime({ english: session('english') }),
    r=runtime({ math: session('math') })
  const before=structuredClone([a,l,r])
  const result=merge({ancestor:a, local:l, remote:r})
  assert.equal(result.status,'merged',result.reason)
  assert.deepEqual(Object.keys(result.dailySessions), ['english','math'])
  assert.deepEqual(result.changedDictionaries, ['english','math'])
  assert.equal(result.convergenceComplete,false)
  assert.deepEqual([a,l,r],before)
  const inverse=merge({ancestor:a,local:r,remote:l})
  assert.deepEqual(inverse.dailySessions,result.dailySessions)
})
test('one active session can advance while other device unchanged',()=>{
  const old=session('english')
  const newer={...old,blockCount:1,completedBlockIds:['block-1'],
    accumulatedActiveSeconds:20}
  const result=merge({ancestor:runtime({english:old}),
    local:runtime({english:newer}),remote:runtime({english:old})})
  assert.equal(result.status,'merged',result.reason)
  assert.equal(result.dailySessions.english.blockCount,1)
})
test('same-dictionary divergent active cursors never select a winner',()=>{
  const old=session('english')
  const local={...old,blockCount:1,completedBlockIds:['left']}
  const remote={...old,blockCount:1,completedBlockIds:['right']}
  const result=merge({ancestor:runtime({english:old}),
    local:runtime({english:local}),remote:runtime({english:remote})})
  assert.equal(result.status,'blocked')
  assert.equal(result.reason,'concurrent-daily-session-divergence:english')
})
test('identically completed cohort is idempotent regardless of device order',()=>{
  const old=session('english')
  const done={...old,status:'completed',completedAt:1800003600}
  const result=merge({ancestor:runtime({english:old}),
    local:runtime({english:done}),remote:runtime({english:done})})
  assert.equal(result.status,'merged',result.reason)
  assert.deepEqual(result.dailySessions.english,done)
})
test('new independent same-dictionary cohorts never collapse',()=>{
  const x=merge({ancestor:runtime({}),
    local:runtime({english:session('english','A')}),
    remote:runtime({english:session('english','B')})})
  assert.equal(x.status,'blocked')
})
test('deletion of an ancestor daily session is never implied by absence',()=>{
  const x=merge({ancestor:runtime({english:session('english')}),
    local:runtime({}),remote:runtime({english:session('english')})})
  assert.equal(x.reason,'ancestral-daily-session-deleted:english')
})
test('unknown future runtime fields and malformed sessions fail closed',()=>{
  const a=runtime({})
  const x=merge({ancestor:a,local:{...runtime({}),future:{cursor:'1'}},
    remote:runtime({})})
  assert.equal(x.reason,'unsupported-learn-runtime-fields')
  const y=merge({ancestor:a,local:runtime({english:{...session('english'),dict:'math'}}),
    remote:runtime({})})
  assert.equal(y.reason,'invalid-daily-session:english')
})
