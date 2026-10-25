/* eslint-env node */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { retrySafeBodyRequest, safeBodyReadFailure } from '../cloud-functions/_shared/safe-body-retry.js'
import { applyStagingEnvironment, assertStagingProject, restoreStagingEnvironment, snapshotStagingEnvironment } from './idle-staging-environment.mjs'

const base = 'https://t.smhe.cn'
const output = resolve(process.env.IDLE_STAGING_OUTPUT || '.diagnostic/idle-staging-trigger')
const snapshotPath = resolve(output, 'rollback-settings.json')
mkdirSync(output, { recursive: true })
const report = { check: 'idle-staging-trigger-v1', productionChanged: false,
  deploymentTriggered: false, multiRegionQualified: false, verdict: 'FAIL' }
let phase = 'preflight'
let projects
let snapshot
let browser
let context
let releaseMaintenance = () => {}
let owner
let username
let password

async function api(path, method = 'GET', body, token) {
  return retrySafeBodyRequest(async () => {
    const response = await fetch(base + path, { method, redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) })
    return { status: response.status, body: await response.json() }
  }, { path, method })
}
async function waitPolicy(enabled, timeout = 60_000) {
  const deadline = Date.now() + timeout
  do {
    try {
      const result = await api('/api/account-policy?qualification=' + Date.now())
      if (result.status === 200 && result.body.enabled === enabled && result.body.idleDays === 180) return
    } catch { /* Bounded read-only propagation observation, never repeat a write. */ }
    await new Promise(resolve => setTimeout(resolve, 2000))
  } while (Date.now() < deadline)
  throw Error('Runtime policy propagation not observed')
}
async function sourceMatches(expected = process.env.IDLE_STAGING_EXPECTED_SHA) {
  assert.match(expected || '', /^[a-f0-9]{40}$/)
  const response = await fetch(base + '/source-commit.txt?qualification=' + Date.now(), { signal: AbortSignal.timeout(20_000) })
  assert.equal(response.status, 200)
  const marker = (await response.text()).trim()
  assert.match(marker, /^[a-f0-9]{7,40}$/)
  assert.ok(expected.startsWith(marker))
  report.applicationSource = marker
}
async function waitSource(expected, timeout = 600_000) {
  const until = Date.now() + timeout
  do {
    try { await sourceMatches(expected); return } catch { /* deployment propagation only */ }
    await new Promise(resolve => setTimeout(resolve, 5000))
  } while (Date.now() < until)
  throw Error('Exact staging deployment not observed')
}
async function waitRestoredDeployment() {
  const repo = process.env.GITHUB_REPOSITORY
  assert.match(repo || '', /^[\w.-]+\/[\w.-]+$/)
  assert.ok(process.env.IDLE_STAGE_GITHUB_TOKEN)
  const until = Date.now() + 600_000
  do {
    try {
      const ref = await fetch('https://api.github.com/repos/' + repo + '/git/ref/heads/edgeone-test', {
        headers: { Authorization: 'Bearer ' + process.env.IDLE_STAGE_GITHUB_TOKEN },
        signal: AbortSignal.timeout(15_000),
      })
      assert.equal(ref.status, 200)
      const head = (await ref.json()).object?.sha
      assert.match(head || '', /^[a-f0-9]{40}$/)
      // A later report-only staging promotion reloads the restored settings.
      assert.notEqual(head, process.env.IDLE_STAGING_EXPECTED_SHA)
      await sourceMatches(head)
      return
    } catch { /* Await normal coordinated staging rollback deployment. */ }
    await new Promise(resolve => setTimeout(resolve, 5000))
  } while (Date.now() < until)
  throw Error('Restored staging deployment not observed')
}
async function disabledProbe() {
  phase = 'restore-runtime-execution-probe'
  username = 'e2e_idle_restore_' + process.env.GITHUB_RUN_ID + '_' + process.env.GITHUB_RUN_ATTEMPT
  password = 'Idle-restoration-' + crypto.randomUUID()
  report.registrationAttempted = true
  const created = await api('/api/auth/register', 'POST', { username, password, deviceId: 'qwerty-web-' + crypto.randomUUID() })
  assert.equal(created.status, 201)
  owner = created.body.user?.userId
  assert.match(owner || '', /^[a-f0-9]{32}$/)
  const result = await api('/api/maintenance/idle', 'POST', {}, created.body.token)
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'disabled')
  report.runtimeExecutionDisabledObserved = true
}
async function localRecordCount(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise((ok, fail) => { request.onsuccess = () => ok(request.result); request.onerror = () => fail(request.error) })
    try {
      return await new Promise((ok, fail) => {
        const count = db.transaction('wordRecords').objectStore('wordRecords').count()
        count.onsuccess = () => ok(count.result)
        count.onerror = () => fail(count.error)
      })
    } finally { db.close() }
  })
}
async function browserJourney() {
  phase = 'register-disposable-staging-account'
  assert.match(process.env.GITHUB_RUN_ID || '', /^\d+$/)
  assert.match(process.env.GITHUB_RUN_ATTEMPT || '', /^\d+$/)
  username = 'e2e_idle_' + process.env.GITHUB_RUN_ID + '_' + process.env.GITHUB_RUN_ATTEMPT
  password = 'Idle-qualification-' + crypto.randomUUID()
  report.registrationAttempted = true
  const created = await api('/api/auth/register', 'POST', { username, password, deviceId: 'qwerty-web-' + crypto.randomUUID() })
  assert.equal(created.status, 201)
  owner = created.body.user?.userId
  assert.match(owner || '', /^[a-f0-9]{32}$/)
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  page.on('dialog', dialog => dialog.accept())
  let held = false
  const gate = new Promise(resolve => { releaseMaintenance = resolve })
  await page.route('**/api/maintenance/idle', async route => {
    held = true
    await gate
    await route.continue()
  })
  phase = 'real-login-with-independent-maintenance'
  await page.goto(base + '/?s1-account=manage', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-account]')).toBeVisible({ timeout: 60_000 })
  await page.getByLabel('用户名', { exact: true }).fill(username)
  await page.getByLabel('账户密码', { exact: true }).fill(password)
  const signed = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== '/api/auth/login') return false
    return response.status() !== 503 || !safeBodyReadFailure('/api/auth/login', 'POST', 503, await response.json().catch(() => null))
  }, { timeout: 60_000 })
  await page.getByRole('button', { name: '登录', exact: true }).click()
  assert.equal((await signed).status(), 200)
  await expect(page.locator('[data-account-entry]')).toBeVisible({ timeout: 120_000 })
  const information = page.locator('dialog.safety-information-dialog[open]')
  if (await information.isVisible()) await information.getByRole('button', { name: '知道了', exact: true }).click()
  await expect.poll(() => held, { timeout: 15_000 }).toBe(true)
  report.loginCompletedWhileMaintenanceHeld = true
  phase = 'real-learning-while-maintenance-held'
  await expect(page.getByRole('button', { name: '开始 Learn', exact: true })).toBeVisible({ timeout: 35_000 })
  await page.getByRole('button', { name: '开始 Learn', exact: true }).click()
  const word = page.locator('[data-typing-word]').first()
  await expect(word).toBeVisible({ timeout: 35_000 })
  const spelling = await word.getAttribute('data-typing-word')
  assert.ok(spelling)
  const before = await localRecordCount(page)
  if (await page.getByText('按任意键开始', { exact: true }).isVisible().catch(() => false)) await page.keyboard.press('a')
  await page.keyboard.type(spelling)
  await expect.poll(() => localRecordCount(page), { timeout: 50_000 }).toBe(before + 1)
  report.learnedWhileMaintenanceHeld = true
  phase = 'actual-maintenance-response'
  const completed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/maintenance/idle', { timeout: 90_000 })
  releaseMaintenance()
  const response = await completed
  assert.equal(response.status(), 200)
  const maintenance = await response.json()
  assert.ok(['complete', 'paused', 'already_ran'].includes(maintenance.status))
  assert.equal(maintenance.counts?.deleted || 0, 0)
  assert.equal(maintenance.counts?.draining || 0, 0)
  report.maintenanceStatus = maintenance.status
  report.noExpiredAccountAtNewActivationFloor = true
  assert.equal(await localRecordCount(page), before + 1)
  const auth = await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null'))
  assert.equal(auth?.user?.userId, owner)
  const current = await api('/api/auth/me', 'GET', undefined, auth.token)
  assert.equal(current.status, 200)
  assert.equal(current.body.user?.userId, owner)
  report.localRowsAndSessionPreserved = true
}

const mode = process.argv[2]
try {
  assert.equal(process.env.GITHUB_REF_NAME, 'product/main')
  assert.equal(process.env.IDLE_STAGING_ACK, 'RUN_REVERSIBLE_STAGING_IDLE_TRIGGER')
  const projectId = process.env.IDLE_QUALIFICATION_PROJECT_ID
  assertStagingProject(projectId)
  assert.equal(process.env.IDLE_QUALIFICATION_PROJECT_VERIFIED, 'EXACT_ETEST_DOMAIN')
  const require = createRequire(resolve(process.env.IDLE_MAKERS_SDK_DIR, 'package.json'))
  const { Makers } = await import(pathToFileURL(require.resolve('@edgeone/makers-sdk')).href)
  assert.ok(process.env.EDGEONE_API_TOKEN)
  projects = new Makers({ token: process.env.EDGEONE_API_TOKEN }).projects
  if (mode === 'snapshot' || mode === 'apply') await sourceMatches(process.env.IDLE_STAGING_BASE_SHA)
  if (mode === 'snapshot') {
    phase = 'snapshot-before-mutation'
    await waitPolicy(false, 0)
    snapshot = await snapshotStagingEnvironment(projects, projectId)
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n')
    report.snapshotPrepared = true
    report.verdict = 'PASS'
  } else {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    assert.equal(snapshot.projectId, projectId)
    if (mode === 'apply') {
      phase = 'apply-staging-only-settings'
      await applyStagingEnvironment(projects, snapshot)
      report.settingsApplied = true
      report.awaitingStagingDeployment = true
    } else if (mode === 'run') {
      phase = 'wait-exact-staging-deployment'
      await waitSource(process.env.IDLE_STAGING_EXPECTED_SHA)
      phase = 'wait-runtime-policy-activation'
      await waitPolicy(true)
      report.runtimePolicyObserved = true
      await browserJourney()
    } else if (mode === 'confirm') {
      phase = 'wait-restored-staging-deployment'
      await waitRestoredDeployment()
      await disabledProbe()
    } else assert.equal(mode, 'restore')
    report.verdict = 'PASS'
  }
} catch {
  report.verdict = 'FAIL'
  report.failureStage = phase
  if (report.registrationAttempted && !owner) report.testAccountCreationUnconfirmed = true
} finally {
  releaseMaintenance()
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  if (owner) {
    try {
      const fresh = await api('/api/auth/login', 'POST', { username, password, deviceId: 'qwerty-web-' + crypto.randomUUID() })
      assert.equal(fresh.status, 200)
      assert.equal(fresh.body.user?.userId, owner)
      const deleted = await api('/api/auth/account', 'DELETE', { currentPassword: password }, fresh.body.token)
      assert.equal(deleted.status, 200)
      assert.equal(deleted.body.deleted?.accountDeleted, true)
      report.testAccountCleanupVerified = true
    } catch { report.testAccountCleanupVerified = false; report.verdict = 'FAIL' }
  }
  if (snapshot && projects && (mode === 'run' || mode === 'restore' || (mode === 'apply' && report.verdict === 'FAIL'))) {
    try {
      report.rollback = await restoreStagingEnvironment(projects, snapshot)
      report.runtimeRestoreNeedsDeployment = true
    } catch { report.rollback = { restored: false }; report.verdict = 'FAIL' }
  }
  const name = mode + '-result.json'
  writeFileSync(resolve(output, name), JSON.stringify(report, null, 2) + '\n')
  console.log('IDLE_STAGING_TRIGGER ' + JSON.stringify(report))
}
if (report.verdict !== 'PASS') process.exitCode = 1
