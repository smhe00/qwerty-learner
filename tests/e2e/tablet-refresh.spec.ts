import { readReviewModeInfo, reviewWords, seedAcquisitionSession } from './review-flow-harness'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

test.use({ hasTouch: true, isMobile: false, viewport: { width: 1024, height: 600 } })
test.setTimeout(60000)

async function attempts(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<any[]>((resolve, reject) => {
        const query = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').getAll()
        query.onsuccess = () => resolve(query.result)
        query.onerror = () => reject(query.error)
      })
    } finally {
      db.close()
    }
  })
}

for (const phase of ['exposure', 'supported'] as const) {
  for (const audio of ['blocked', 'pending'] as const) {
    test(`tablet refresh ${phase} with ${audio} audio retains a reachable action`, async ({ page }, info) => {
      // Valid local bytes isolate autoplay/pending behavior from network errors.
      await page.route('**/dictvoice?**', (route) =>
        route.fulfill({ contentType: 'audio/mpeg', body: readFileSync('public/sounds/key-sound/Alpacas.mp3') }),
      )
      await page.addInitScript((behavior) => {
        HTMLMediaElement.prototype.play = function () {
          return behavior === 'blocked'
            ? Promise.reject(new DOMException('autoplay blocked', 'NotAllowedError'))
            : new Promise<void>(() => {})
        }
      }, audio)
      await seedAcquisitionSession(page, reviewWords, 982810 + (phase === 'exposure' ? 0 : 2) + (audio === 'blocked' ? 0 : 1), phase)
      await page.goto('/mobile/study')
      const card = page.locator('[data-mobile-word-practice]')
      await expect(card).toBeVisible({ timeout: 30000 })
      const before = await readReviewModeInfo(page)
      await page.reload()
      await expect(card).toBeVisible({ timeout: 30000 })
      await page.screenshot({ path: info.outputPath('refreshed.png') })
      for (const name of ['返回主菜单', '暂停学习']) {
        const control = page.getByRole('button', { name, exact: true })
        await expect(control).toBeInViewport({ ratio: 1 })
        const bounds = (await control.boundingBox())!
        expect(bounds.width).toBeGreaterThanOrEqual(44)
        expect(bounds.height).toBeGreaterThanOrEqual(44)
      }

      expect((await readReviewModeInfo(page)).reviewRecord.id).toBe(before.reviewRecord.id)
      const action =
        phase === 'exposure'
          ? card.getByRole('button', { name: '继续学习', exact: true })
          : card.getByRole('button', { name: /点按播放声音|重试播放声音|无法播放/ })
      await expect(action).toBeVisible()
      await expect(action).toBeInViewport({ ratio: 1 })
      await expect(action).toBeEnabled()
      if (phase === 'exposure') {
        await action.tap()
        await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
        expect(await attempts(page)).toHaveLength(1)
      }
      if (phase === 'supported' && audio === 'pending') {
        await expect(card).toHaveAttribute('data-mobile-audio-state', 'loading')
        const word = await card.getAttribute('data-mobile-word')
        expect(await attempts(page)).toHaveLength(0)
        await card.getByRole('button', { name: '先练词义', exact: true }).tap()
        await expect(card).toHaveAttribute('data-mobile-task', 'meaning-choice')
        await expect(card).toHaveAttribute('data-mobile-word', word!)
        expect(await attempts(page)).toHaveLength(0)
        await card.getByRole('button', { name: reviewWords.find((item) => item.name === word)!.trans[0], exact: true }).tap()
        await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
        const saved = await attempts(page)
        expect(saved).toHaveLength(1)
        expect(saved[0].learningContext.pronunciationPlayed).toBe(false)
        expect(saved[0].reviewEvidence.reasonCodes).toContain('mobile-task-meaning-choice')
        expect(saved[0].reviewEvidence.reasonCodes).not.toContain('mobile-task-audio')
        await page.reload()
        await expect(card).toBeVisible({ timeout: 30000 })
        expect(await attempts(page)).toHaveLength(1)
      }
    })
  }
}

test('short landscape viewport keeps controls reachable after refresh', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'))
  })
  await seedAcquisitionSession(page, reviewWords, 982820, 'supported')
  await page.setViewportSize({ width: 1024, height: 220 })
  await page.goto('/mobile/study')
  const card = page.locator('[data-mobile-word-practice]')
  await expect(card).toBeVisible({ timeout: 30000 })
  await page.reload()
  await expect(card).toBeVisible({ timeout: 30000 })
  const play = card.getByRole('button', { name: '点按播放声音' })
  await expect(play).toBeInViewport({ ratio: 1 })
  await play.tap({ timeout: 3000 })
})

test('refresh before the page becomes visible never strands audio without a playback owner', async ({ page }) => {
  await page.addInitScript(() => {
    let hidden = true
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    ;(window as any).__showStudy = () => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    }
  })
  await seedAcquisitionSession(page, reviewWords, 982821, 'supported')
  await page.goto('/mobile/study')
  const card = page.locator('[data-mobile-word-practice]')
  await expect(card).toBeVisible({ timeout: 30000 })
  await page.reload()
  await expect(card).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => (window as any).__showStudy())
  await expect(card).toHaveAttribute('data-mobile-audio-state', 'tap')
  await expect(card.getByRole('button', { name: '先练词义', exact: true })).toBeInViewport({ ratio: 1 })
})

test('wide tablet touch layout separates reading and right-hand actions through rotation', async ({ page }, info) => {
  await seedAcquisitionSession(page, reviewWords, 982822)
  await page.goto('/mobile/study')
  const card = page.locator('[data-mobile-word-practice]')
  await expect(card).toBeVisible({ timeout: 30000 })
  const originalCard = await card.elementHandle()
  const before = await readReviewModeInfo(page)
  for (const viewport of [
    { width: 1024, height: 600 },
    { width: 1366, height: 768 },
    { width: 1180, height: 400 },
  ]) {
    await page.setViewportSize(viewport)
    const reading = (await card.locator('[data-mobile-reading]').boundingBox())!
    const actions = (await card.locator('[data-mobile-action-zone]').boundingBox())!
    expect(reading.x + reading.width).toBeLessThanOrEqual(actions.x)
    for (const button of await card.locator('[data-mobile-grade], [data-mobile-input-preference]').all()) {
      await expect(button).toBeInViewport({ ratio: 1 })
      const bounds = (await button.boundingBox())!
      expect(bounds.width).toBeGreaterThanOrEqual(44)
      expect(bounds.height).toBeGreaterThanOrEqual(44)
    }
    expect(await originalCard!.evaluate((element) => element === document.querySelector('[data-mobile-word-practice]'))).toBe(true)
    expect(await readReviewModeInfo(page)).toEqual(before)
    await page.screenshot({ path: info.outputPath('tablet-' + viewport.width + '.png') })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const reading = (await card.locator('[data-mobile-reading]').boundingBox())!
  const actions = (await card.locator('[data-mobile-action-zone]').boundingBox())!
  expect(reading.y + reading.height).toBeLessThanOrEqual(actions.y)
  expect(await originalCard!.evaluate((element) => element === document.querySelector('[data-mobile-word-practice]'))).toBe(true)
  expect(await readReviewModeInfo(page)).toEqual(before)
})
