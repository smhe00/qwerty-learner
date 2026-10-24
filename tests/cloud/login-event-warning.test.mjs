import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'qwerty-login-warning-'))
after(() => rmSync(tmp, { recursive: true, force: true }))
const mocks = {
  './api':
    'export class SyncApiError extends Error {}; export const login=(...x)=>globalThis.__warning.login(...x); export const register=login; export const changePassword=login;',
  './auth':
    'export const browserDeviceId=()=>"synthetic-device"; export const loadAuth=()=>globalThis.__warning.auth; export const setIsolatedAuthRetention=()=>{};',
  './learning-sync-policy': 'export const learningEventSyncEnabled=()=>true;',
  './mobile-account-view': 'export const presentAccount=(view)=>{globalThis.__warning.view=view; return {setBusy(){}}};',
  './workspace-auth-transaction':
    'export const switchAuthenticatedWorkspace=(...x)=>globalThis.__warning.switch(...x); export const reauthenticateSameWorkspace=()=>{}; export const reconcileAuthTransition=async()=>"none";',
  './workspace-coordinator':
    'export const copyAnonymousWorkspaceForNewRegistration=()=>{throw Error("unexpected copy")}; export const recoverPendingWorkspace=async()=>{throw Error("unexpected recovery")};',
  './workspace-vault': 'export const workspaceRegistryPort={read:async()=>globalThis.__warning.registry};',
  './account-login-v4-check': 'export const checkAccountV4AfterAuthentication=()=>globalThis.__warning.v4();',
  './m3-publication-browser': 'export const runEtestM3Publication=()=>globalThis.__warning.m3();',
  './v2-pull-recovery': 'export const recoverPendingSyncV2Pull=async()=>{throw Error("unexpected recovery")};',
  './manual-v4-import-recovery': 'export const recoverPendingManualV4Import=async()=>{throw Error("unexpected recovery")};',
  './m4-merge-browser-recovery': 'export const recoverPendingM4Merge=async()=>{throw Error("unexpected recovery")};',
  './workspace-lock': 'export const acquireWorkspaceWriterLease=async()=>({release(){}});',
  './workspace-storage-witness':
    'export const assertWorkspaceMigrationWitness=()=>{}; export const refreshWorkspaceMigrationWitness=()=>{}; export const installWorkspaceStorageWriterGuard=()=>{};',
  './v2-pull-journal': 'export const syncV2PullJournalPort={read:async()=>null};',
  './manual-v4-import-journal': 'export const manualV4ImportJournalPort={read:async()=>null};',
  './m4-merge-journal': 'export const m4MergeJournalPort={read:async()=>null};',
  './m4-witnessed-prefix-browser': 'export const adoptWitnessedM3AtGuardedBoot=()=>globalThis.__warning.m4();',
}
async function compile(source, name) {
  const output = join(tmp, name + '.mjs')
  await build({
    entryPoints: [resolve(root, source)],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    define: { REACT_APP_DEPLOY_ENV: '"edgeone"', 'import.meta.env.VITE_S2_ENABLE_UNIFIED_SYNC': '"true"' },
    plugins: [
      {
        name: 'login-io',
        setup(b) {
          b.onResolve({ filter: /^\.\// }, (x) => (x.path in mocks ? { path: x.path, namespace: 'mock' } : undefined))
          b.onLoad({ filter: /.*/, namespace: 'mock' }, (x) => ({ contents: mocks[x.path] }))
        },
      },
    ],
  })
  return import(pathToFileURL(output).href)
}
const { renderS1AccountManagement: render } = await compile('src/sync/workspace-account-ui.ts', 'login')
const { prepareGuardedWorkspaceBoot: boot } = await compile('src/sync/workspace-bootstrap.ts', 'boot')
const { recordLearningSyncDiagnostic } = await compile('src/sync/learning-sync-diagnostics.ts', 'diagnostics')
const recoveryOutput = join(tmp, 'recovery.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/multi-device-recovery.ts')],
  outfile: recoveryOutput,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
})
const { planOutboxRecovery } = await import(pathToFileURL(recoveryOutput).href)
const cycleOutput = join(tmp, 'cycle.mjs')
await build({
  entryPoints: [resolve(root, 'src/sync/m3-publication-cycle.ts')],
  outfile: cycleOutput,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
})
const { runM3PublicationCycle } = await import(pathToFileURL(cycleOutput).href)

function element() {
  return {
    value: '',
    textContent: '',
    setAttribute() {},
    append() {},
    replaceChildren() {},
    addEventListener(name, action) {
      this[name] = action
    },
  }
}
const event = {
  id: 1,
  attemptId: '00000000-0000-4000-8000-000000000001',
  dict: 'synthetic',
  word: 'example',
  sourceMode: 'learn',
  chapter: 0,
  timeStamp: 1800000000,
  timing: [],
  wrongCount: 0,
  mistakes: {},
}
const fullV4 = ''
async function loginAgain({ rows = [], failure, v4Continue = true, adoption = 'skipped' } = {}) {
  const original = structuredClone(rows)
  const calls = []
  const session = new Map()
  globalThis.sessionStorage = {
    getItem: (k) => session.get(k) ?? null,
    setItem: (k, v) => session.set(k, v),
    removeItem: (k) => session.delete(k),
  }
  globalThis.document = { createElement: element }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
  let navigated
  const done = new Promise((resolve) => {
    navigated = resolve
  })
  globalThis.window = { confirm: () => true, location: { pathname: '/', search: '', replace: navigated } }
  globalThis.localStorage = { getItem: (k) => (k === 'qwerty.s1.workspace-migrated.v1' ? 'v2' : null) }
  const state = (globalThis.__warning = {
    auth: null,
    registry: { generation: 1, pending: null, active: { kind: 'anonymous' } },
    async login() {
      calls.push('login')
      return { user: { userId: 'synthetic', username: 'synthetic' }, token: 'synthetic', expiresAt: 9e9 }
    },
    async switch(active, auth) {
      calls.push('switch')
      this.auth = auth
      this.registry = { generation: 2, pending: null, active }
    },
    async v4() {
      calls.push('v4')
      return { status: v4Continue ? 'noop' : 'pull-staged', detail: fullV4, canContinue: v4Continue }
    },
    async m3() {
      calls.push('m3')
      const result = await runM3PublicationCycle({
        async assertOwner() {},
        async recover() {
          const plan = planOutboxRecovery(rows)
          if (plan.status === 'blocked') throw Error('outbox-recovery-' + plan.reason)
          return { scanned: plan.count, pending: 0 }
        },
        async publish() {
          calls.push('publish')
          return failure ? { status: 'retained', reason: failure } : { status: 'idle' }
        },
      })
      recordLearningSyncDiagnostic({
        stage: 'm3-publication',
        status: result.status,
        code: result.status === 'blocked' ? result.reason : 'none',
      })
      return result
    },
    async m4() {
      calls.push('m4')
      // Same precondition as the real M4 adapter: it first invokes M3 again.
      const published = await this.m3()
      if (published.status === 'blocked') return { status: 'blocked', reason: 'm3-publication:' + published.reason }
      return { status: adoption, reason: 'synthetic', newAttempts: adoption === 'adopted' ? 1 : 0 }
    },
  })
  render(element(), { kind: 'anonymous' })
  await Promise.resolve()
  state.view.username.value = 'synthetic'
  state.view.password.value = 'synthetic'
  state.view.controls.find((x) => x.textContent === '登录已有账户').click()
  let timeout
  try {
    await Promise.race([
      done,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error('login did not navigate')), 2000)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
  assert.deepEqual(calls, ['login', 'switch'], 'account UI must not run a duplicate sync pipeline')
  try {
    await boot()
  } catch (error) {
    assert.match(error.message, /S2 Pull staged; reload required|M4 merge recovery completed; reload required/)
  }
  assert.deepEqual(rows, original, 'login must never repair/reidentify the source rows')
  // Successful authentication is quiet; only actionable sync notices open a dialog.
  const summary = session.get('qwerty.s2.last-sync-result') ?? ''
  const diagnostics = JSON.parse(session.get('qwerty.learning-sync-diagnostics.v1') || '[]')
  return { calls, summary, diagnostics }
}

for (const legacy of [
  { ...event, attemptId: undefined },
  { ...event, sourceMode: undefined },
]) {
  test('unchanged legacy history allows publication and reception without a compatibility warning', async () => {
    const { calls, summary } = await loginAgain({ rows: [legacy, { ...event, attemptId: '00000000-0000-4000-8000-000000000002' }] })
    assert.deepEqual(calls, ['login', 'switch', 'v4', 'm4', 'm3', 'publish'])
    assert.equal(summary, '')
  })
}
test('actually invalid historical fields block once, with details only in diagnostics', async () => {
  const { calls, summary, diagnostics } = await loginAgain({ rows: [{ ...event, timeStamp: NaN }] })
  assert.deepEqual(calls, ['login', 'switch', 'v4', 'm4', 'm3'])
  assert.match(summary, /部分学习记录暂未同步/)
  assert.ok(!/V4|事件|格式|诊断|outbox/.test(summary))
  assert.equal(diagnostics.at(-1).code, 'outbox-recovery-invalid-attempt')
})
test('contradictory immutable rows still block, retain history and explain the specific boundary', async () => {
  const { calls, summary } = await loginAgain({ rows: [event, { ...event, wrongCount: 1 }] })
  assert.ok(!calls.includes('publish'))
  assert.match(summary, /部分学习记录暂未同步/)
})
test('transport uncertainty does not retry through M4 or leak the raw error', async () => {
  const { calls, summary, diagnostics } = await loginAgain({ failure: 'private-payload-token' })
  assert.equal(calls.filter((x) => x === 'publish').length, 1)
  assert.equal(calls.filter((x) => x === 'm4').length, 1)
  assert.match(summary, /部分学习记录暂未同步/)
  assert.ok(!JSON.stringify(diagnostics).includes('private-payload-token'))
  assert.ok(!summary.includes('private-payload-token'))
})
test('unchanged valid history still observes remote events instead of skipping M4 because V4 is equal', async () => {
  const { calls, summary } = await loginAgain({ rows: [event] })
  assert.equal(calls.filter((x) => x === 'm4').length, 1)
  assert.ok(!summary.includes('阻止') && !summary.includes('暂缓'))
})
test('genuine downstream M4 rejection remains visible', async () => {
  const { summary } = await loginAgain({ adoption: 'blocked' })
  assert.match(summary, /部分学习记录暂未同步/)
  assert.ok(!summary.includes('M4'))
})
test('verified subset adoption stays quiet instead of claiming all-device convergence', async () => {
  const { summary } = await loginAgain({ adoption: 'adopted' })
  assert.equal(summary, '')
})
test('staged V4 recovery does not enter event publication', async () => {
  const { calls } = await loginAgain({ v4Continue: false })
  assert.deepEqual(calls, ['login', 'switch', 'v4'])
})
