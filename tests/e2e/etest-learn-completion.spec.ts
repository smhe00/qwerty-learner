import { createLearnAcquisitionExercisePlanForState, resumeDeferredAsTerminalProbe } from '../../src/learn/acquisition'
import { loadBodyPolicy } from './body-policy-loader'
import { acknowledgeInformationDialog } from './information-dialog'
import { startTyping } from './review-flow-harness'
import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

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
  await page.getByRole('button', { name: '登录', exact: true }).click()
  expect((await response).status()).toBe(200)
  await expect(page).toHaveURL(/^https:\/\/t\.smhe\.cn\/(?:learn)?$/, { timeout: 120_000 })
  await acknowledgeInformationDialog(page)
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 60_000 })
}
async function meta(page: Page) {
  return page.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null')
    const r = await fetch('/api/sync/v2/meta', { cache: 'no-store', headers: { Authorization: 'Bearer ' + auth.token } })
    if (!r.ok) throw Error('metadata HTTP-' + r.status)
    return r.json()
  })
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
    const source = await fetch(base + '/source-commit.txt?completion=' + sha + '-' + Date.now())
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
    try {
      const created = await request('/api/auth/register', 'POST', { username, password, deviceId: 'qwerty-web-' + randomUUID() })
      expect(created.status).toBe(201)
      owner = created.body.user.userId
      await login(a, username, password)
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
      await a.goto(base + '/learn?block-resume=1', { waitUntil: 'domcontentloaded' })
      await startTyping(a)
      const word = a.locator('[data-typing-word="cancel"]')
      await expect(word).toBeVisible()
      expect(await a.evaluate(() => sessionStorage.getItem('qwerty.learn.block-sync.pending.v1'))).toBeNull()
      if (wrong) {
        await a.keyboard.type('x')
        await expect(word).toHaveAttribute('data-typing-wrong-count', '1')
        await expect(word).toHaveAttribute('data-typing-has-wrong', 'false')
      }
      await a.keyboard.type('cancel', { delay: 40 })
      await expect(a.locator('[data-learn-block-sync]')).toBeVisible({ timeout: 60_000 })
      await expect(a.getByRole('heading', { name: wrong ? '本轮练习已结束' : '今日学习完成', exact: true })).toBeVisible()
      proof.completionPageVisible = true
      await expect(a.getByText('同步完成：本地进度已安全上传至云端。')).toBeVisible({ timeout: 120_000 })
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
      await a.getByRole('button', { name: '再学五词', exact: true }).click()
      await expect(a.locator('[data-typing-word]')).toBeVisible({ timeout: 60_000 })
      const extra = (await records(a)).daily
      expect(extra.extraRoundWordNames).toHaveLength(5)
      if (wrong) expect(extra.extraRoundWordNames[0]).toBe('cancel')
      expect(extra.executionExhausted).toBeUndefined()
      expect(extra.blockCount).toBe(1)
      await a.reload({ waitUntil: 'domcontentloaded' })
      await expect(a.locator('[data-typing-word]')).toBeVisible({ timeout: 60_000 })
      expect((await records(a)).daily.plannedNewWords).toBe(extra.plannedNewWords)
      expect((await meta(a)).revision).toBe(uploaded.revision)
      proof.extraWords = 5
      proof.reloadDidNotDuplicateExtension = true
      // Park A before B takes the sole login session. B must pull the actual
      // Blob from an empty profile, proving the final answer reached storage.
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
      expect(restored.reviews).toEqual(final.reviews)
      expect(restored.states).toEqual(final.states)
      expect(restored.daily.status).toBe(final.daily.status)
      expect(restored.daily.executionExhausted).toBe(final.daily.executionExhausted)
      expect((await meta(b)).revision).toBe(uploaded.revision)
      proof.freshProfileCloudReadbackExact = true
      proof.cloudWordRecords = restored.words.length
      proof.finalAttemptPresentExactlyOnce = restored.words.filter((r) => r.attemptId === final.words[1].attemptId).length === 1
    } catch (e) {
      failures.push(e)
      proof.applicationFailed = true
    } finally {
      await Promise.allSettled(contexts.map((c) => c.close()))
      try {
        if (owner) {
          const fresh = await request('/api/auth/login', 'POST', { username, password, deviceId: 'qwerty-web-' + randomUUID() })
          expect(fresh.status).toBe(200)
          expect(fresh.body.user.userId === owner).toBe(true)
          const removed = await request('/api/auth/account', 'DELETE', { currentPassword: password }, fresh.body.token)
          proof.cleanupStatus = removed.status
          expect(removed.status).toBe(200)
          expect(removed.body.deleted?.accountDeleted).toBe(true)
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
      const messages = failures.map((e) => String(e instanceof Error ? e.stack : e).split(password).join('[redacted-password]'))
      throw new Error(messages.join('\n'))
    }
  })
}
