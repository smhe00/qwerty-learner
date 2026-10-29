import { createLearnAcquisitionExercisePlanForState, resumeDeferredAsTerminalProbe } from '../../src/learn/acquisition'
import { cleanupAccount } from './account-cleanup-loader'
import { loadBodyPolicy } from './body-policy-loader'
import { acknowledgeInformationDialog } from './information-dialog'
import { startTyping } from './review-flow-harness'
import { type Page, expect, test } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

// Only the unfinished BEFORE state is a fixture. Login, final keyboard answer,
// settlement, completion screen, S1/V4 upload, five-more and fresh-profile pull
// all use the deployed product and real staging HTTP/Blob; no request mocking.
const base = 'https://t.smhe.cn'
const dailyKey = 'qwerty.learn.dailySession.v1.cet4'
async function request(path: string, method: string, body?: object, token?: string) {
  const { retrySafeBodyRequest } = await loadBodyPolicy()
  return retrySafeBodyRequest(
    async () => {
      const r = await fetch(base + path, {
        method,
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(40_000),
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      return { status: r.status, body: await r.json() }
    },
    { path, method },
  )
}
async function account(page: Page) {
  await page.goto(base + '/?s1-account=manage', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-account]')).toBeVisible({ timeout: 60_000 })
}
async function login(page: Page, username: string, password: string) {
  await account(page)
  await page.getByLabel('用户名', { exact: true }).fill(username)
  await page.getByLabel('账户密码', { exact: true }).fill(password)
  const response = page.waitForResponse(
    async (r) => {
      if (new URL(r.url()).pathname !== '/api/auth/login') return false
      if (r.status() !== 503) return true
      const { safeBodyReadFailure } = await loadBodyPolicy()
      return !safeBodyReadFailure('/api/auth/login', 'POST', r.status(), await r.json().catch(() => null))
    },
    { timeout: 60_000 },
  )
  const confirmation = page.waitForEvent('dialog', { timeout: 60_000 }).then(async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    expect(dialog.message()).toBe('登录“' + username + '”后，将使用该账号的学习记录。本机未登录时的记录会保留，不会自动合并。继续登录？')
    await dialog.accept()
  })
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await confirmation
  expect((await response).status()).toBe(200)
  await expect(page).toHaveURL(/^https:\/\/t\.smhe\.cn\/(?:learn)?$/, { timeout: 120_000 })
  // Pinned real-cloud diagnosis proved a successful full-V4 restore can
  // still be publishing/verifying immutable evidence at 60s, then mount
  // naturally around 80s. Preserve all exact readback/3-device assertions;
  // only this live login phase gets a bounded network startup budget.
  await acknowledgeInformationDialog(page, 180_000)
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 60_000 })
}
async function meta(page: Page) {
  return page.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null')
    const r = await fetch('/api/sync/v2/meta', {
      signal: AbortSignal.timeout(40000),
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + auth.token },
    })
    if (!r.ok) throw Error('metadata HTTP-' + r.status)
    return r.json()
  })
}
async function pinnedSnapshot(page: Page, revision: number, fingerprint: string, owner: string) {
  // Read immutable cloud bytes before starting the extra round. This does not
  // trigger a login/session transfer or any application write.
  const { manifest, parts } = await page.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null')
    const headers = { Authorization: 'Bearer ' + auth.token }
    const response = await fetch('/api/sync/v2/binary/manifest', { headers, cache: 'no-store', signal: AbortSignal.timeout(40000) })
    if (!response.ok) throw Error('manifest HTTP-' + response.status)
    const manifest = await response.json()
    if (!Number.isInteger(manifest.count) || manifest.count < 1 || manifest.count > 64) throw Error('invalid part count')
    const parts: number[][] = []
    for (let index = 0; index < manifest.count; index++) {
      const params = new URLSearchParams({ revision: String(manifest.revision), sha: manifest.payloadSha256, index: String(index) })
      const r = await fetch('/api/sync/v2/binary/part?' + params, { headers, cache: 'no-store', signal: AbortSignal.timeout(40000) })
      if (!r.ok) throw Error('part HTTP-' + r.status)
      parts.push(Array.from(new Uint8Array(await r.arrayBuffer())))
    }
    return { manifest, parts }
  })
  expect(manifest.revision).toBe(revision)
  expect(manifest.logicalFingerprint).toBe(fingerprint)
  expect(manifest.payloadEncoding).toBe('binary')
  const buffers = parts.map((part, index) => {
    const bytes = Buffer.from(part)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.partSha256s[index])
    return bytes
  })
  const bytes = Buffer.concat(buffers)
  expect(bytes.length).toBe(manifest.sizeBytes)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.payloadSha256)
  const snapshot = JSON.parse(gunzipSync(bytes).toString('utf8'))
  expect(snapshot.backupFormatVersion).toBe('qwerty-backup-v4')
  expect(snapshot.metadata.source.kind).toBe('account')
  expect(snapshot.metadata.source.accountId === owner).toBe(true)
  return snapshot.workspaceData
}
async function records(page: Page) {
  return page.evaluate(async (key) => {
    const req = indexedDB.open('RecordDB')
    req.onupgradeneeded = () => req.transaction?.abort()
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      req.onsuccess = () => ok(req.result)
      req.onerror = () => fail(req.error)
    })
    try {
      const read = (table: string) =>
        new Promise<any[]>((ok, fail) => {
          const r = db.transaction(table).objectStore(table).getAll()
          r.onsuccess = () => ok(r.result)
          r.onerror = () => fail(r.error)
        })
      const [words, reviews, states] = await Promise.all(['wordRecords', 'reviewRecords', 'reviewWordStates'].map(read))
      return { words, reviews, states, daily: JSON.parse(localStorage.getItem(key) || 'null') }
    } finally {
      db.close()
    }
  }, dailyKey)
}
async function seedUnfinishedLastWord(page: Page) {
  // Pre-mount account document: no concurrent React learning writer.
  await account(page)
  const state = resumeDeferredAsTerminalProbe({ version: 1, phase: 'deferred', assistedCycles: 7, deferredReason: 'assistance' })!
  const plan = createLearnAcquisitionExercisePlanForState(state)
  await page.evaluate(
    async ({ key, state, plan }) => {
      const req = indexedDB.open('RecordDB')
      req.onupgradeneeded = () => req.transaction?.abort()
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        req.onsuccess = () => ok(req.result)
        req.onerror = () => fail(req.error)
      })
      try {
        const now = Math.floor(Date.now() / 1000)
        const d = new Date()
        const dateKey = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
        const add = (table: string, row: object) =>
          new Promise<IDBValidKey>((ok, fail) => {
            const tx = db.transaction(table, 'readwrite')
            const r = tx.objectStore(table).add(row)
            tx.oncomplete = () => ok(r.result)
            tx.onerror = () => fail(tx.error)
            tx.onabort = () => fail(tx.error)
          })
        localStorage.setItem('currentDict', JSON.stringify('cet4'))
        localStorage.setItem('currentChapter', '-1')
        localStorage.setItem('memoryConfig', JSON.stringify({ dailyNewWordTarget: 1, blockSize: 20 }))
        localStorage.setItem(
          'pronunciation',
          JSON.stringify({
            isOpen: false,
            volume: 1,
            type: 'us',
            name: '美音',
            isLoop: false,
            isTransRead: false,
            transVolume: 1,
            rate: 1,
          }),
        )
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            sessionId: 'completion-cloud-before',
            dict: 'cet4',
            dateKey,
            startedAt: now - 60,
            status: 'active',
            dailyNewTarget: 1,
            plannedNewWords: 1,
            plannedNewWordNames: ['cancel'],
            plannedReviewWords: [],
            carryOverAcquisitionWords: [],
            blockMilestones: [1],
            celebratedMilestones: [],
            accumulatedActiveSeconds: 0,
            completedBlockIds: [],
            blockCount: 0,
          }),
        )
        await add('wordRecords', {
          word: 'cancel',
          dict: 'cet4',
          chapter: -1,
          timeStamp: now - 50,
          sourceMode: 'learn',
          learnItemKind: 'acquisition',
          wrongCount: 0,
          timing: [],
          mistakes: {},
          reviewPolicyDecision: {
            version: 1,
            policyVersion: 'learn-acquisition-exposure-v1',
            reasonCodes: ['visible-copy'],
            conditionVersion: 1,
          },
        })
        const record = {
          sessionId: 'cloud-last-word-before',
          dict: 'cet4',
          createTime: now - 30,
          words: [{ name: 'cancel', trans: ['取消'], usphone: '', ukphone: '' }],
          index: 0,
          isFinished: false,
          sessionKind: 'acquisition',
          blockSize: 20,
          acquisitionStates: { cancel: state },
          exercisePlans: { cancel: plan },
          itemKinds: { cancel: 'acquisition' },
          optionalNewWords: [],
          spacingWords: [],
        }
        const id = await add('reviewRecords', record)
        localStorage.setItem('reviewModeInfo', JSON.stringify({ isReviewMode: true, reviewRecord: { ...record, id } }))
      } finally {
        db.close()
      }
    },
    { key: dailyKey, state, plan },
  )
}

for (const wrong of [true, false]) {
  test(`real cloud last word → completion → sync → five more (${wrong ? 'unmastered' : 'complete'})`, async ({ browser }, info) => {
    expect(process.env.GITHUB_REF_NAME).toBe('edgeone-test')
    expect(process.env.QWERTY_SYNC_BASE_URL).toBe(base + '/')
    const sha = process.env.GITHUB_SHA || ''
    expect(sha).toMatch(/^[a-f0-9]{40}$/)
    console.log('COMPLETION_PHASE', JSON.stringify({ case: wrong ? 'unmastered' : 'complete', stage: 'source-check' }))
    const source = await fetch(base + '/source-commit.txt?completion=' + sha + '-' + Date.now(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
    expect(source.status).toBe(200)
    const deployed = (await source.text()).trim()
    expect(deployed).toMatch(/^[a-f0-9]{7,40}$/)
    expect(sha.startsWith(deployed)).toBe(true)
    const username = 'e2e_end_' + process.env.GITHUB_RUN_ID + '_' + (process.env.GITHUB_RUN_ATTEMPT || '1') + '_' + (wrong ? 'w' : 'c')
    expect(username).toMatch(/^e2e_end_\d+_\d+_[wc]$/)
    const password = 'Completion-' + randomUUID()
    const contexts = await Promise.all([browser.newContext({ serviceWorkers: 'block' }), browser.newContext({ serviceWorkers: 'block' })])
    const [a, b] = await Promise.all(contexts.map((c) => c.newPage()))
    let owner: string | undefined
    const proof: Record<string, unknown> = {
      source: deployed,
      case: wrong ? 'unmastered' : 'complete',
      beforeStateFixture: true,
      networkMocked: false,
    }
    const failures: unknown[] = []
    const diagnosticStartedAt = Date.now()
    const http: Array<Record<string, unknown>> = []
    for (const [profile, page] of [a, b].entries())
      page.on('response', async (response) => {
        const path = new URL(response.url()).pathname
        if (!path.startsWith('/api/')) return
        const item: Record<string, unknown> = {
          profile,
          phase: stage,
          path,
          method: response.request().method(),
          status: response.status(),
        }
        http.push(item)
        if (response.status() >= 400) {
          const body = await response.json().catch(() => null)
          if (typeof body?.error === 'string' && /^[a-z0-9_-]{1,80}$/.test(body.error)) item.code = body.error
        }
      })
    let stage = 'register'
    const checkpoint = (next: string) => {
      stage = next
      console.log('COMPLETION_PHASE', JSON.stringify({ case: proof.case, stage, elapsedMs: Date.now() - diagnosticStartedAt }))
    }
    checkpoint(stage)
    try {
      const created = await request('/api/auth/register', 'POST', { username, password, deviceId: 'qwerty-web-' + randomUUID() })
      expect(created.status).toBe(201)
      owner = created.body.user.userId
      checkpoint('first-login')
      await login(a, username, password)
      checkpoint('seed-unfinished-before-state')
      await seedUnfinishedLastWord(a)
      const before = await records(a)
      expect(before.words).toHaveLength(1)
      expect(before.reviews[0].isFinished).toBe(false)
      expect(before.daily.blockCount).toBe(0)
      const initial = await meta(a)
      const committed: number[] = []
      a.on('response', (r) => {
        if (new URL(r.url()).pathname === '/api/sync/v2/binary/direct') committed.push(r.status())
      })
      checkpoint('last-word-entry')
      await a.goto(base + '/learn?block-resume=1', { waitUntil: 'domcontentloaded' })
      await expect(a).toHaveURL(base + '/learn')
      const word = a.locator('[data-typing-word="cancel"]')
      await expect(word).toBeVisible()
      await startTyping(a)
      expect(await a.evaluate(() => sessionStorage.getItem('qwerty.learn.block-sync.pending.v1'))).toBeNull()
      if (wrong) {
        await a.keyboard.type('x')
        await expect(word).toHaveAttribute('data-typing-wrong-count', '1')
        await expect(word).toHaveAttribute('data-typing-has-wrong', 'false')
      }
      await a.addInitScript(() => {
        new MutationObserver(() => {
          const card = document.querySelector('[data-learn-block-sync]')
          if (!card) return
          const item = { title: card.querySelector('h1')?.textContent, metrics: card.querySelectorAll('.focus-result-metric').length }
          const entries = JSON.parse(sessionStorage.getItem('completion-display-proof') || '[]')
          if (JSON.stringify(entries.at(-1)) !== JSON.stringify(item)) {
            entries.push(item)
            sessionStorage.setItem('completion-display-proof', JSON.stringify(entries))
          }
        }).observe(document, { childList: true, subtree: true })
      })
      checkpoint('last-answer-and-completion-sync')
      await a.keyboard.type('cancel', { delay: 40 })
      await expect(a.locator('[data-learn-block-sync]')).toBeVisible({ timeout: 60_000 })
      await expect(a.getByRole('heading', { name: wrong ? '本轮练习已结束' : '今日学习完成', exact: true })).toBeVisible()
      proof.completionPageVisible = true
      const metrics = a.locator('[data-focus-result-metrics] .focus-result-metric')
      await expect(metrics).toHaveCount(6)
      const visibleSummary = await metrics.allTextContents()
      await expect(a.getByText('同步完成：本地进度已安全上传至云端。')).toBeVisible({ timeout: 120_000 })
      expect(await metrics.allTextContents()).toEqual(visibleSummary)
      const displayHistory = await a.evaluate(() => JSON.parse(sessionStorage.getItem('completion-display-proof') || '[]'))
      expect(displayHistory.length).toBeGreaterThan(0)
      expect(
        displayHistory.every(
          (entry: { title: string; metrics: number }) => entry.title === (wrong ? '本轮练习已结束' : '今日学习完成') && entry.metrics === 6,
        ),
      ).toBe(true)
      proof.completionSummaryPersisted = true
      proof.completionDisplayHistory = displayHistory
      const final = await records(a)
      expect(final.words).toHaveLength(2)
      expect(final.words[1].attemptId).toMatch(/^[a-f0-9-]{36}$/)
      expect(final.words[1].wrongCount > 0).toBe(wrong)
      expect(final.daily.status).toBe(wrong ? 'active' : 'completed')
      if (wrong) {
        expect(final.daily.executionExhausted).toBe(true)
        expect(final.states).toHaveLength(0)
      }
      const uploaded = await meta(a)
      expect(uploaded.revision).toBe(initial.revision + 1)
      expect(uploaded.clientFormatVersion).toBe('qwerty-backup-v4')
      expect(committed.filter((s) => s === 200)).toHaveLength(1)
      proof.committedUploads = 1
      proof.cloudRevision = uploaded.revision
      checkpoint('completion-blob-readback')
      const cloud = await pinnedSnapshot(a, uploaded.revision, uploaded.logicalFingerprint, owner!)
      const cloudWords = cloud.database.data.data.find((table: any) => table.tableName === 'wordRecords').rows
      expect(cloudWords).toHaveLength(2)
      expect(cloudWords[1].attemptId).toBe(final.words[1].attemptId)
      expect(cloudWords[1].wrongCount).toBe(final.words[1].wrongCount)
      expect(cloud.learnRuntime.dailySessions.cet4.status).toBe(final.daily.status)
      expect(cloud.learnRuntime.dailySessions.cet4.executionExhausted).toBe(final.daily.executionExhausted)
      proof.completionBlobHashVerified = true
      checkpoint('five-more-and-reload')
      await a.getByRole('button', { name: '再学五词', exact: true }).click()
      await expect(a).toHaveURL(base + '/learn')
      await expect(a.locator('[data-typing-word]')).toBeVisible({ timeout: 60_000 })
      const extra = (await records(a)).daily
      expect(extra.extraRoundWordNames).toHaveLength(5)
      if (wrong) expect(extra.extraRoundWordNames[0]).toBe('cancel')
      expect(extra.executionExhausted).toBeUndefined()
      expect(extra.blockCount).toBe(1)
      await a.reload({ waitUntil: 'domcontentloaded' })
      await expect(a.locator('[data-typing-word]')).toBeVisible({ timeout: 60_000 })
      const afterReload = await records(a)
      expect(afterReload.daily.plannedNewWords).toBe(extra.plannedNewWords)
      expect(afterReload.daily.plannedNewWordNames).toEqual(extra.plannedNewWordNames)
      expect(afterReload.daily.extraRoundWordNames).toEqual(extra.extraRoundWordNames)
      expect(afterReload.daily.blockCount).toBe(1)
      expect(afterReload.words).toEqual(final.words)
      expect(afterReload.states).toEqual(final.states)
      // A matching cloud baseline defers local changes on ordinary startup.
      // Explicit sync must still persist the extra round exactly once.
      proof.extraWords = 5
      proof.reloadDidNotDuplicateExtension = true
      checkpoint('extra-round-startup-deferral')
      proof.reloadStartupStatus = await a.evaluate(() => sessionStorage.getItem('qwerty.s2.startup-check.v1'))
      expect(proof.reloadStartupStatus).toBe('upload-deferred')
      proof.observedUploadStatuses = [...committed]
      expect(committed.filter((s) => s === 200)).toHaveLength(1)
      const deferred = await meta(a)
      expect(deferred.revision).toBe(uploaded.revision)
      expect(deferred.logicalFingerprint).toBe(uploaded.logicalFingerprint)
      proof.reloadDeferredUpload = true
      checkpoint('extra-round-explicit-sync')
      await a.goto(base + '/?s2-sync=run', { waitUntil: 'domcontentloaded' })
      await expect(a).toHaveURL(/^https:\/\/t\.smhe\.cn\/(?:learn)?$/, { timeout: 180_000 })
      await expect(a.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 90_000 })
      expect(await records(a)).toEqual(afterReload)
      await expect.poll(() => committed.filter((s) => s === 200).length, { timeout: 30_000 }).toBe(2)
      // Metadata visibility can lag the acknowledged immutable commit. Poll
      // reads only; never replay an uncertain upload to satisfy this check.
      await expect.poll(async () => (await meta(a)).revision, { timeout: 30_000 }).toBe(uploaded.revision + 1)
      const resumed = await meta(a)
      expect(resumed.revision).toBe(uploaded.revision + 1)
      expect(committed.filter((s) => s === 200)).toHaveLength(2)
      proof.extraRoundExplicitSyncRevision = resumed.revision
      proof.totalCommittedUploads = 2
      // Park A before B takes the sole login session. B must pull the actual
      // Blob from an empty profile, proving the final answer reached storage.
      checkpoint('fresh-profile-cloud-readback')
      await account(a)
      const downloads: string[] = []
      b.on('request', (r) => {
        const path = new URL(r.url()).pathname
        if (path.startsWith('/api/sync/')) downloads.push(r.method() + ' ' + path)
      })
      await login(b, username, password)
      const restored = await records(b)
      expect(downloads).toContain('GET /api/sync/v2/binary/manifest')
      expect(downloads).toContain('GET /api/sync/v2/binary/part')
      expect(restored.words).toEqual(final.words)
      expect(restored.reviews).toEqual(afterReload.reviews)
      expect(restored.states).toEqual(final.states)
      expect(restored.daily.status).toBe(afterReload.daily.status)
      expect(restored.daily.executionExhausted).toBe(afterReload.daily.executionExhausted)
      expect(restored.daily.extraRoundWordNames).toEqual(afterReload.daily.extraRoundWordNames)
      expect(restored.daily.plannedNewWordNames).toEqual(afterReload.daily.plannedNewWordNames)
      expect((await meta(b)).revision).toBe(resumed.revision)
      proof.freshProfileCloudReadbackExact = true
      proof.cloudWordRecords = restored.words.length
      expect(restored.words.filter((r) => r.attemptId === final.words[1].attemptId)).toHaveLength(1)
      proof.finalAttemptPresentExactlyOnce = true
    } catch (e) {
      failures.push(e)
      proof.applicationFailed = true
      proof.failedStage = stage
      proof.http = http
      proof.failedPageState = await Promise.all(
        [a, b].map((page, profile) =>
          page
            .evaluate(() => ({
              path: location.pathname,
              rootChildren: document.querySelector('#root')?.childElementCount,
              bodyText: document.body.innerText.slice(0, 2400),
              accountEntry: document.querySelectorAll('[data-account-entry]').length,
              accountForm: document.querySelectorAll('[data-account]').length,
              dialogs: Array.from(document.querySelectorAll('dialog[open]')).map((x) => ({
                label: x.getAttribute('aria-label'),
                text: x.textContent?.slice(0, 300),
              })),
              startup: sessionStorage.getItem('qwerty.s2.startup-check.v1'),
              diagnostics: JSON.parse(sessionStorage.getItem('qwerty.learning-sync-diagnostics.v1') || '[]'),
            }))
            .then((state) => ({ profile, ...state }))
            .catch(() => ({ profile, unavailable: true })),
        ),
      )
      // Diagnostic only: retain the original failed assertion, then observe
      // natural boot progress without clicks, reloads or request replays.
      if (stage === 'fresh-profile-cloud-readback' && process.env.QWERTY_LOGIN_LATENCY_DIAGNOSTIC === 'true') {
        const observations: Array<Record<string, unknown>> = []
        for (let sample = 1; sample <= 9; sample++) {
          await b.waitForTimeout(10000)
          const state = await b
            .evaluate(() => ({
              bodyText: document.body.innerText.slice(0, 2400),
              accountEntry: document.querySelectorAll('[data-account-entry]').length,
              startup: sessionStorage.getItem('qwerty.s2.startup-check.v1'),
              diagnostics: JSON.parse(sessionStorage.getItem('qwerty.learning-sync-diagnostics.v1') || '[]'),
            }))
            .catch(() => null)
          observations.push({ elapsedMs: Date.now() - diagnosticStartedAt, ...state })
          if (state?.accountEntry) break
        }
        proof.naturalBootAfterTimeout = JSON.parse(
          JSON.stringify(observations).split(username).join('[fixture-account]').split(password).join('[redacted]'),
        )
      }
      proof.failedPageState = JSON.parse(
        JSON.stringify(proof.failedPageState).split(username).join('[fixture-account]').split(password).join('[redacted]'),
      )
    } finally {
      // Preserve the application result before teardown consumes any remaining test budget.
      // This checkpoint is not a cleanup success and never hides the original failure.
      proof.lastStage = stage
      await writeFile(info.outputPath('completion-redacted-trace.json'), JSON.stringify(proof, null, 2))
      checkpoint('cleanup')
      await Promise.allSettled(contexts.map((c) => c.close()))
      try {
        if (owner) {
          const cleanup = await cleanupAccount({ baseUrl: base, username, password, userId: owner })
          proof.cleanup = cleanup
          expect(cleanup.confirmed).toBe(true)
          proof.cleanupVerified = true
        }
      } catch (e) {
        failures.push(e)
        proof.cleanupFailed = true
      }
      await writeFile(info.outputPath('completion-redacted-trace.json'), JSON.stringify(proof, null, 2))
      console.log('COMPLETION_CLOUD_REDACTED', JSON.stringify(proof))
    }
    if (failures.length) {
      const messages = failures.map((e) =>
        String(e instanceof Error ? e.stack : e)
          .split(password)
          .join('[redacted-password]'),
      )
      throw new Error(messages.join('\n'))
    }
  })
}
