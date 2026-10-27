import { readReviewModeInfo, startTyping } from './review-flow-harness'
import { type Page, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

const owner = { kind: 'account', accountId: 'completion-journey-owner' }
const dailyKey = 'qwerty.learn.dailySession.v1.cet4'

// Only seed the BEFORE state. The last answer, settlement, pending handoff,
// guarded S1 boot, V4 capture, and extra-round entry must all be product code.
async function seedLastWord(page: Page, signedIn = true, remainingNewWord = false) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.db))).toBe(true)
  await page.addScriptTag({
    type: 'module',
    content: "import * as acquisition from '/src/learn/acquisition.ts'; window.__completionAcquisition = acquisition",
  })
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__completionAcquisition))).toBe(true)
  await page.evaluate(
    async ({ identity, signedIn, dailyKey, remainingNewWord }) => {
      const h = (window as any).__backupHarness
      await h.db.open()
      const now = Math.floor(Date.now() / 1000)
      const date = new Date()
      const dateKey = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
      localStorage.setItem('currentDict', JSON.stringify('cet4'))
      localStorage.setItem('currentChapter', '-1')
      localStorage.setItem('reviewModeInfo', JSON.stringify({ isReviewMode: true }))
      localStorage.setItem('memoryConfig', JSON.stringify({ dailyNewWordTarget: 1, blockSize: 20 }))
      localStorage.setItem(
        'pronunciation',
        JSON.stringify({ isOpen: false, volume: 1, type: 'us', name: '美音', isLoop: false, isTransRead: false, transVolume: 1, rate: 1 }),
      )
      localStorage.setItem(
        dailyKey,
        JSON.stringify({
          version: 1,
          sessionId: 'completion-journey',
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
      await h.db.wordRecords.add({
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
      const acquisition = (window as any).__completionAcquisition
      const state = acquisition.resumeDeferredAsTerminalProbe(
        {
          version: 1,
          phase: 'deferred',
          assistedCycles: 7,
          deferredReason: 'assistance',
          resumeAfter: now + 300,
        },
        now,
      )
      const record = {
        sessionId: 'last-word-session',
        dict: 'cet4',
        createTime: now - 30,
        words: [{ name: 'cancel', trans: ['取消'], usphone: '', ukphone: '' }],
        index: 0,
        isFinished: false,
        sessionKind: 'acquisition',
        blockSize: 20,
        acquisitionStates: { cancel: state },
        exercisePlans: { cancel: acquisition.createLearnAcquisitionExercisePlanForState(state) },
        itemKinds: { cancel: 'acquisition' },
        optionalNewWords: [],
        spacingWords: [],
      }
      const id = await h.db.reviewRecords.add(record)
      localStorage.setItem('reviewModeInfo', JSON.stringify({ isReviewMode: true, reviewRecord: { ...record, id } }))
      if (remainingNewWord) {
        const daily = JSON.parse(localStorage.getItem(dailyKey)!)
        localStorage.setItem(
          dailyKey,
          JSON.stringify({
            ...daily,
            plannedNewWords: 2,
            dailyNewTarget: 2,
            plannedNewWordNames: ['cancel', 'analyse'],
            blockMilestones: [2],
          }),
        )
        localStorage.setItem('memoryConfig', JSON.stringify({ dailyNewWordTarget: 2, blockSize: 20 }))
      }
      if (signedIn) {
        localStorage.setItem(
          'qwerty.cloudAuth.v1',
          JSON.stringify({
            token: 'completion-journey-synthetic-token',
            expiresAt: now + 3600,
            user: { userId: identity.accountId, username: 'completion-journey' },
          }),
        )
        await h.initializeLegacyWorkspace(identity)
      }
    },
    { identity: owner, signedIn, dailyKey, remainingNewWord },
  )
  await page.goto('/learn?block-resume=1')
  // The landing page also says 'press any key'; wait for the actual word
  // after the resume intent is consumed before starting the typing engine.
  await expect(page).toHaveURL(/\/learn$/)
  await expect(page.locator('[data-typing-word="cancel"]')).toBeVisible()
  await startTyping(page)
  expect(await page.evaluate(() => sessionStorage.getItem('qwerty.learn.block-sync.pending.v1'))).toBeNull()
  expect((await readReviewModeInfo(page)).reviewRecord.acquisitionStates.cancel.terminalProbe).toBe(true)
}

async function answerLastWord(page: Page, wrong: boolean) {
  if (wrong) {
    await page.keyboard.type('x')
    const word = page.locator('[data-typing-word="cancel"]')
    await expect(word).toHaveAttribute('data-typing-wrong-count', '1')
    await expect(word).toHaveAttribute('data-typing-has-wrong', 'false')
  }
  await page.keyboard.type('cancel', { delay: 40 })
}

async function network(page: Page, failure = false) {
  let releaseMetadata!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseMetadata = resolve
  })
  const uploads: any[] = []
  let metaRequests = 0
  let failing = failure
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, json: { error: 'unexpected-local-fixture-request' } }))
  await page.route('**/api/health', (route) => route.fulfill({ json: { ok: true, serverTimeMs: Date.now() } }))
  await page.route('**/api/sync/v2/meta', async (route) => {
    metaRequests++
    await gate
    if (failing) return route.fulfill({ status: 503, json: { error: 'fixture-offline' } })
    await route.fulfill({
      json: {
        ok: true,
        hasData: false,
        revision: 0,
        updatedAt: null,
        sizeBytes: 0,
        dataSha256: null,
        payloadSha256: null,
        logicalFingerprint: null,
        deviceId: null,
        clientFormatVersion: null,
      },
    })
  })
  await page.route('**/api/sync/v2/binary/direct', async (route) => {
    expect(route.request().method()).toBe('POST')
    const headers = route.request().headers()
    expect(headers['x-qwerty-base-revision']).toBe('0')
    const blob = route.request().postDataBuffer()!
    const hash = createHash('sha256').update(blob).digest('hex')
    expect(headers['x-qwerty-payload-sha256']).toBe(hash)
    const snapshot = JSON.parse(gunzipSync(blob).toString('utf8'))
    expect(snapshot.backupFormatVersion).toBe('qwerty-backup-v4')
    expect(snapshot.metadata.source).toEqual(owner)
    uploads.push(snapshot)
    await route.fulfill({
      json: {
        ok: true,
        hasData: true,
        revision: 1,
        updatedAt: new Date().toISOString(),
        sizeBytes: blob.length,
        dataSha256: hash,
        payloadSha256: hash,
        logicalFingerprint: headers['x-qwerty-logical-fingerprint'],
        deviceId: 'completion-e2e',
        clientFormatVersion: 'qwerty-backup-v4',
        storageEncoding: 'binary',
      },
    })
  })
  return {
    uploads,
    releaseMetadata,
    metaRequests: () => metaRequests,
    recover: () => {
      failing = false
    },
  }
}

for (const wrong of [true, false]) {
  test(`last actual word → completion → guarded V4 sync → five more (${wrong ? 'retained unmastered word' : 'daily complete'})`, async ({
    page,
  }) => {
    const net = await network(page)
    await page.addInitScript(() => {
      new MutationObserver(() => {
        const card = document.querySelector('[data-learn-block-sync]')
        if (!card) return
        const entry = { title: card.querySelector('h1')?.textContent, metrics: card.querySelectorAll('.focus-result-metric').length }
        const history = JSON.parse(sessionStorage.getItem('completion-ui-history') || '[]')
        if (JSON.stringify(history.at(-1)) !== JSON.stringify(entry)) {
          history.push(entry)
          sessionStorage.setItem('completion-ui-history', JSON.stringify(history))
        }
      }).observe(document, { childList: true, subtree: true })
    })
    await seedLastWord(page)
    await answerLastWord(page, wrong)
    await expect(page.locator('[data-learn-block-sync]')).toBeVisible()
    await expect(page.getByRole('heading', { name: wrong ? '本轮练习已结束' : '今日学习完成', exact: true })).toBeVisible()
    await expect(page.getByRole('button')).toHaveCount(0)
    expect(net.uploads).toHaveLength(0)
    const metrics = page.locator('[data-focus-result-metrics] .focus-result-metric')
    await expect(metrics).toHaveCount(6)
    const summary = await metrics.allTextContents()
    // Test a narrow completion viewport without changing the app's mobile routing.
    if (!wrong) await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => net.metaRequests()).toBeGreaterThan(0)
    // The network gate is still held: progress must not vanish when boot advances.
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', wrong ? '0' : '100')
    expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: 'blob-report/completion-feedback-copy/' + (wrong ? 'desktop-syncing' : 'mobile-syncing') + '.png' })
    net.releaseMetadata()
    await expect(page.getByText('同步完成：本地进度已安全上传至云端。')).toBeVisible({ timeout: 30_000 })
    expect(net.uploads).toHaveLength(1)
    const data = net.uploads[0].workspaceData
    const rows = data.database.data.data.find((x: any) => x.tableName === 'wordRecords').rows
    expect(rows).toHaveLength(2)
    expect(rows[1].wrongCount > 0).toBe(wrong)
    expect(data.learnRuntime.dailySessions.cet4.status).toBe(wrong ? 'active' : 'completed')
    if (wrong) {
      expect(data.learnRuntime.dailySessions.cet4.executionExhausted).toBe(true)
      expect(data.database.data.data.find((x: any) => x.tableName === 'reviewWordStates').rows).toHaveLength(0)
    }
    expect(await metrics.allTextContents()).toEqual(summary)
    // Exercise the post-recovery return document with the real guarded boot.
    // This is UI restoration evidence, not a simulated claim of a remote pull.
    await page.goto('/?learn-block-sync=result')
    await expect(page.getByRole('button', { name: '再学五词', exact: true })).toBeEnabled()
    expect(await metrics.allTextContents()).toEqual(summary)
    const history = await page.evaluate(() => JSON.parse(sessionStorage.getItem('completion-ui-history') || '[]'))
    expect(history.length).toBeGreaterThan(0)
    expect(history.every((entry: { title: string; metrics: number }) =>
      entry.title === (wrong ? '本轮练习已结束' : '今日学习完成') && entry.metrics === 6)).toBe(true)
    expect(net.uploads).toHaveLength(1)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('button', { name: '再学五词', exact: true }).click()
    await expect(page.locator('[data-typing-word]')).toBeVisible()
    const daily = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), dailyKey)
    expect(daily.extraRoundWordNames).toHaveLength(5)
    if (wrong) expect(daily.extraRoundWordNames[0]).toBe('cancel')
    expect(daily.executionExhausted).toBeUndefined()
    expect(daily.blockCount).toBe(1)
    const beforeReload = daily.plannedNewWords
    await page.reload()
    await expect(page.locator('[data-typing-word]')).toBeVisible()
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).plannedNewWords, dailyKey)).toBe(beforeReload)
    expect(net.uploads).toHaveLength(1)
  })
}

test('last failed word → sync failure → explicit retry retains exactly one final answer', async ({ page }) => {
  const net = await network(page, true)
  await seedLastWord(page)
  await answerLastWord(page, true)
  await expect(page.locator('[data-learn-block-sync]')).toBeVisible()
  const metrics = page.locator('[data-focus-result-metrics] .focus-result-metric')
  await expect(metrics).toHaveCount(6)
  const summary = await metrics.allTextContents()
  net.releaseMetadata()
  await expect(page.getByRole('button', { name: '重试同步', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: '再学五词', exact: true })).toHaveCount(0)
  expect(net.uploads).toHaveLength(0)
  expect(await metrics.allTextContents()).toEqual(summary)
  net.recover()
  await page.getByRole('button', { name: '重试同步', exact: true }).click()
  await expect(page.getByText('同步完成：本地进度已安全上传至云端。')).toBeVisible({ timeout: 30_000 })
  expect(net.uploads).toHaveLength(1)
  expect(await metrics.allTextContents()).toEqual(summary)
  expect(net.uploads[0].workspaceData.database.data.data.find((x: any) => x.tableName === 'wordRecords').rows).toHaveLength(2)
})

test('anonymous failed last word keeps an honest end screen without cloud requests', async ({ page }) => {
  const net = await network(page)
  await seedLastWord(page, false)
  await answerLastWord(page, true)
  await expect(page.locator('[data-learn-round-ended]')).toBeVisible()
  await expect(page.getByRole('heading', { name: '本轮练习已结束', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '多学五词', exact: true })).toBeEnabled()
  const daily = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), dailyKey)
  expect(daily.status).toBe('active')
  expect(daily.executionExhausted).toBe(true)
  expect(daily.blockCount).toBe(1)
  expect(net.metaRequests()).toBe(0)
  expect(net.uploads).toHaveLength(0)
})

test('an internal queue boundary with fresh work continues without end sync or five-more', async ({ page }) => {
  const net = await network(page)
  await seedLastWord(page, true, true)
  const firstId = (await readReviewModeInfo(page)).reviewRecord.id
  await answerLastWord(page, true)
  await expect.poll(async () => (await readReviewModeInfo(page)).reviewRecord.id).not.toBe(firstId)
  const current = (await readReviewModeInfo(page)).reviewRecord
  expect(current.isFinished).toBe(false)
  expect(current.words.some((word: { name: string }) => word.name === 'analyse')).toBe(true)
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).executionExhausted, dailyKey)).toBeUndefined()
  await expect(page.locator('[data-learn-block-sync]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '多学五词', exact: true })).toHaveCount(0)
  expect(net.metaRequests()).toBe(0)
})

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return
  const state = await page
    .evaluate((key) => {
      const daily = JSON.parse(localStorage.getItem(key) ?? 'null')
      const record = JSON.parse(localStorage.getItem('reviewModeInfo') ?? 'null')?.reviewRecord
      return { daily, recordId: record?.id, finished: record?.isFinished, cursor: record?.index }
    }, dailyKey)
    .catch(() => null)
  await info.attach('completion-state.json', { body: Buffer.from(JSON.stringify(state)), contentType: 'application/json' })
})
