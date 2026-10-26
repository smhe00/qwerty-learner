import { expect, test, type Page } from '@playwright/test'
import { readReviewModeInfo, readReviewWordRecords, reviewWords, seedAcquisitionSession, seedReviewSession, startTyping, waitForActiveLearnSession, waitForReviewIndex } from './review-flow-harness'

async function prepare(page: Page, single = false) {
  await seedReviewSession(page, single ? reviewWords.slice(0, 1) : reviewWords, 910026)
  await page.goto('/learn')
  await waitForActiveLearnSession(page)
  await startTyping(page)
  await page.addScriptTag({ type: 'module', content: "import { db } from '/src/utils/db/core.ts'; window.__saveFailureDb = db" })
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__saveFailureDb))).toBe(true)
}

for (const failure of ['negative-id', 'reject', 'abort'] as const) {
  test(`Learn ${failure}: retain word and checkpoint, manual retry saves once`, async ({ page }) => {
    await prepare(page)
    const before = await readReviewModeInfo(page)
    await page.evaluate((mode) => {
      const table = (window as any).__saveFailureDb.wordRecords
      const original = table.add.bind(table)
      const fixture = { calls: 0, fail: true, original, attempts: [] as unknown[] }
      ;(window as any).__saveFailure = fixture
      table.add = async (record: unknown) => {
        fixture.calls++
        fixture.attempts.push(structuredClone(record))
        if (fixture.fail) {
          if (mode === 'negative-id') return -1
          if (mode === 'reject') throw new DOMException('injected quota failure', 'QuotaExceededError')
          // Exercise a real Dexie transaction abort, not just an error string.
          return table.db.transaction('rw', table, async (tx: any) => {
            await original(record)
            tx.abort()
          })
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
        return original(record)
      }
    }, failure)
    await page.keyboard.type('cancel')
    await expect(page.getByRole('alert')).toContainText('学习记录保存失败，本词尚未推进')
    await page.keyboard.press('Space')
    expect((await readReviewModeInfo(page)).reviewRecord).toEqual(before.reviewRecord)
    expect(await readReviewWordRecords(page, ['cancel'])).toHaveLength(0)
    await expect(page.locator('[data-typing-word="cancel"]')).toBeVisible()
    await expect(page.locator('[data-learn-result-screen]')).toHaveCount(0)
    // A repeated failure remains recoverable without automatic replay.
    await page.getByRole('button', { name: '重试保存', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).__saveFailure.calls)).toBe(2)
    await expect(page.getByRole('button', { name: '重试保存', exact: true })).toBeEnabled()
    await page.evaluate(() => { (window as any).__saveFailure.fail = false })
    // Two clicks in one turn must not produce two concurrent writes.
    await page.getByRole('button', { name: '重试保存', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
    await waitForReviewIndex(page, 1)
    expect(await readReviewWordRecords(page, ['cancel'])).toHaveLength(1)
    expect(await page.evaluate(() => (window as any).__saveFailure.calls)).toBe(3)
    const attempts = await page.evaluate(() => (window as any).__saveFailure.attempts)
    expect(attempts[2].reviewEvidence).toEqual(attempts[0].reviewEvidence)
    expect(attempts[2].typingTelemetry).toEqual(attempts[0].typingTelemetry)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
}

test('last word cannot settle while raw save fails', async ({ page }) => {
  await prepare(page, true)
  await page.evaluate(() => { (window as any).__saveFailureDb.wordRecords.add = async () => -1 })
  await page.keyboard.type('cancel')
  await expect(page.getByRole('alert')).toContainText('本词尚未推进')
  await page.keyboard.press('Space')
  expect((await readReviewModeInfo(page)).reviewRecord.isFinished).toBe(false)
  await expect(page.locator('[data-learn-result-screen]')).toHaveCount(0)
  expect(await readReviewWordRecords(page, ['cancel'])).toHaveLength(0)
})

test('leaving a pending save does not release the old completion callback', async ({ page }) => {
  await prepare(page)
  const before = await readReviewModeInfo(page)
  await page.evaluate(() => {
    const table = (window as any).__saveFailureDb.wordRecords
    const original = table.add.bind(table)
    table.add = (record: unknown) => new Promise((resolve, reject) => {
      ;(window as any).__releaseSave = () => original(record).then(resolve, reject)
    })
  })
  await page.keyboard.type('cancel')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseSave))).toBe(true)
  await page.evaluate(() => {
    history.pushState({}, '', '/gallery')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.locator('[data-typing-word]')).toHaveCount(0)
  await page.evaluate(() => (window as any).__releaseSave())
  await expect.poll(async () => (await readReviewWordRecords(page, ['cancel'])).length).toBe(1)
  expect((await readReviewModeInfo(page)).reviewRecord).toEqual(before.reviewRecord)
  await expect(page.locator('[data-learn-result-screen]')).toHaveCount(0)
})

test('derived FSRS failure retains raw evidence and still advances without unhandled rejection', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await prepare(page)
  await page.evaluate(() => {
    ;(window as any).__projectionFailures = 0
    ;(window as any).__saveFailureDb.reviewWordStates.put = async () => {
      ;(window as any).__projectionFailures++
      throw new Error('injected derived projection failure')
    }
  })
  await page.keyboard.type('cancel')
  await waitForReviewIndex(page, 1)
  await expect.poll(() => page.evaluate(() => (window as any).__projectionFailures)).toBeGreaterThan(0)
  await page.addScriptTag({ type: 'module', content: "import { flushLearnPersistence } from '/src/learn/persistence.ts'; await flushLearnPersistence(); window.__projectionDrained = true" })
  await expect.poll(() => page.evaluate(() => (window as any).__projectionDrained)).toBe(true)
  const records = await readReviewWordRecords(page, ['cancel'])
  expect(records).toHaveLength(1)
  expect(records[0].reviewRatingDecision?.eligible).toBe(true)
  await expect(page.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('touch failure retries frozen self-report and a menu return keeps its receipt without another write', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedAcquisitionSession(page, reviewWords, 910027, 'independent', 4)
  await page.goto('/mobile/study')
  const card = page.locator('[data-mobile-word-practice]')
  await expect(card).toBeVisible()
  await expect(card.locator('[data-mobile-paused]')).toHaveCount(0)
  await page.addScriptTag({ type: 'module', content: "import { db } from '/src/utils/db/core.ts'; window.__saveFailureDb = db" })
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__saveFailureDb))).toBe(true)
  const before = await readReviewModeInfo(page)
  await page.evaluate(() => {
    const table = (window as any).__saveFailureDb.wordRecords
    const add = table.add.bind(table)
    ;(window as any).__touchSave = { fail: true, calls: 0 }
    table.add = (record: unknown) => {
      const fixture = (window as any).__touchSave
      fixture.calls++
      return fixture.fail ? Promise.reject(new Error('injected touch quota failure')) : add(record)
    }
  })
  await card.locator('[data-mobile-grade="again"]').click()
  await expect(page.getByRole('alert')).toContainText('本词尚未推进')
  expect((await readReviewModeInfo(page)).reviewRecord).toEqual(before.reviewRecord)
  expect(await readReviewWordRecords(page, ['cancel'])).toHaveLength(0)
  await page.evaluate(() => { (window as any).__touchSave.fail = false })
  await page.getByRole('button', { name: /保存失败.*重试/ }).click()
  await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
  const records = await readReviewWordRecords(page, ['cancel'])
  expect(records).toHaveLength(1)
  expect(records[0].reviewEvidence.reasonCodes).toContain('self-report-not-spelling')
  expect(records[0].attemptId).toBeTruthy()
  await page.evaluate(() => { history.pushState({}, '', '/mobile'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await expect(card).toHaveCount(0)
  await page.evaluate(() => { history.pushState({}, '', '/mobile/study'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
  if (await card.locator('[data-mobile-paused]').isVisible()) await page.keyboard.press('Enter')
  await card.locator('[data-mobile-manual-next]').click()
  await expect(card.locator('[data-mobile-feedback]')).toHaveCount(0)
  expect(await readReviewWordRecords(page, ['cancel'])).toHaveLength(1)
  expect(await page.evaluate(() => (window as any).__touchSave.calls)).toBe(2)
})
