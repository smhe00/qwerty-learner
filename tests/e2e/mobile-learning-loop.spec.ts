import { readReviewModeInfo, reviewWords, seedAcquisitionSession, seedReviewSession } from './review-flow-harness'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
test.setTimeout(60_000)
const practice = (page: Page) => page.locator('[data-mobile-word-practice]')

async function openStudy(page: Page, id: number, review = false) {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.resolve()
    }
  })
  if (review) await seedReviewSession(page, reviewWords.slice(0, 1), id)
  else await seedAcquisitionSession(page, reviewWords, id)
  await page.goto('/mobile/study')
  await expect(practice(page)).toBeVisible({ timeout: 30_000 })
}

async function finishReview(page: Page) {
  await practice(page).getByRole('button', { name: '学习方式：轻触', exact: true }).click()
  const field = practice(page).getByRole('textbox', { name: '独立拼写单词' })
  const word = await practice(page).getAttribute('data-mobile-word')
  await field.fill(word!)
  await field.press('Enter')
  await expect(page.locator('[data-mobile-complete]')).toBeVisible({ timeout: 15_000 })
}

async function dailyState(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4') || '{}'))
}

test('home previews canonical daily progress without creating a session and exposes local routes', async ({ page }) => {
  await page.goto('/mobile')
  await expect(page.locator('[data-mobile-daily-progress]')).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('qwerty.learn.dailySession.')))).toEqual([])
  await expect(page.getByRole('progressbar', { name: '今日目标进度' })).toHaveAttribute('aria-valuenow', '0')
  await page.getByRole('link', { name: /^设置/ }).click()
  await expect(page.getByRole('heading', { name: '学习设置' })).toBeVisible()
  await page.setViewportSize({ width: 1100, height: 820 })
  await expect(page.getByRole('heading', { name: '学习设置' })).toBeVisible()
  await page.getByRole('link', { name: '返回首页' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
})

test('settings validate bounds, preserve unrelated preferences and survive reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('loop-settings-seeded')) return
    sessionStorage.setItem('loop-settings-seeded', 'yes')
    localStorage.setItem('memoryConfig', JSON.stringify({ dailyNewWordTarget: 20, blockSize: 10, futurePreference: 'keep' }))
    localStorage.setItem(
      'pronunciation',
      JSON.stringify({ isOpen: false, isLoop: true, isTransRead: true, transVolume: 0.4, volume: 0.8, rate: 1, type: 'uk', name: '英音' }),
    )
  })
  await page.goto('/mobile/settings')
  const daily = page.getByLabel('每日新词目标')
  const block = page.getByLabel('每阶段词数')
  await expect(daily).toHaveValue('20', { timeout: 30_000 })
  await daily.fill('0')
  await page.getByRole('button', { name: '保存设置' }).click()
  expect(await daily.evaluate((element: HTMLInputElement) => element.validity.rangeUnderflow)).toBe(true)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('memoryConfig') || '{}').dailyNewWordTarget)).toBe(20)
  await daily.fill('15')
  await block.fill('7')
  await page.getByLabel('发音', { exact: true }).selectOption('us')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByRole('status')).toContainText('设置已保存在本机')
  const config = await page.evaluate(() => ({
    memory: JSON.parse(localStorage.getItem('memoryConfig') || '{}'),
    audio: JSON.parse(localStorage.getItem('pronunciation') || '{}'),
  }))
  expect(config.memory).toMatchObject({ dailyNewWordTarget: 15, blockSize: 7, futurePreference: 'keep' })
  expect(config.audio).toMatchObject({ type: 'us', isOpen: false, isLoop: true, isTransRead: true, transVolume: 0.4 })
  await page.reload()
  await expect(daily).toHaveValue('15')
  await expect(block).toHaveValue('7')
  await page.getByLabel('深色模式').check()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.screenshot({ path: '.review-test/mobile-settings-dark.png', fullPage: true })
})

test('dictionary selection cancels safely and preserves the old checkpoint through switching away and back', async ({ page }) => {
  await openStudy(page, 960201)
  await page.getByRole('button', { name: '返回主菜单' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  const before = await readReviewModeInfo(page)
  await page.getByRole('link', { name: /^词库/ }).click()
  await page.getByLabel('搜索词库').fill('六级')
  const target = page.getByRole('button', { name: /选择词库：.*六级/ }).first()
  await expect(target).toBeVisible()
  page.once('dialog', (dialog) => dialog.dismiss())
  await target.click()
  expect((await readReviewModeInfo(page)).reviewRecord.id).toBe(before.reviewRecord.id)
  page.once('dialog', (dialog) => dialog.accept())
  await target.click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('currentDict') || 'null'))).not.toBe('cet4')
  await page.getByRole('link', { name: /^词库/ }).click()
  await page.getByLabel('搜索词库').fill('四级')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '选择词库：CET-4', exact: true }).click()
  await expect(page.locator('[data-mobile-checkpoint-status]')).toContainText('上次学到本轮第 1 / 3 词')
  await page.getByRole('link', { name: '继续手机学习' }).click()
  await expect(practice(page)).toBeVisible()
  expect((await readReviewModeInfo(page)).reviewRecord.id).toBe(before.reviewRecord.id)
})

test('failed checkpoint write blocks exit, keeps spelling input and retries without losing the word', async ({ page }) => {
  await openStudy(page, 960202)
  await practice(page).getByRole('button', { name: '学习方式：轻触', exact: true }).click()
  const field = practice(page).getByRole('textbox', { name: '独立拼写单词' })
  await field.fill('ca')
  const before = await readReviewModeInfo(page)
  const word = await practice(page).getAttribute('data-mobile-word')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    ;(window as any).__restoreCheckpointWrite = () => {
      IDBObjectStore.prototype.put = original
    }
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'reviewRecords') throw new DOMException('Injected checkpoint write failure', 'QuotaExceededError')
      return original.apply(this, args as any)
    }
  })
  await page.getByRole('button', { name: '返回主菜单' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('暂时无法返回菜单')
  await page.screenshot({ path: '.review-test/mobile-save-failure.png' })
  await expect(page).toHaveURL(/mobile\/study$/)
  expect((await readReviewModeInfo(page)).reviewRecord.id).toBe(before.reviewRecord.id)
  await dialog.getByRole('button', { name: '留在此页' }).click()
  await page.getByRole('button', { name: '继续学习', exact: true }).first().click()
  await expect(practice(page)).toHaveAttribute('data-mobile-word', word!)
  await expect(field).toHaveValue('ca')
  await page.getByRole('button', { name: '返回主菜单' }).click()
  await expect(dialog).toContainText('暂时无法返回菜单')
  await page.evaluate(() => (window as any).__restoreCheckpointWrite())
  await dialog.getByRole('button', { name: '重试保存并返回' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await expect(page.getByRole('link', { name: '继续手机学习' })).toBeVisible()
  const saved = await page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<any>((resolve, reject) => {
        const query = database.transaction('reviewRecords', 'readonly').objectStore('reviewRecords').get(960202)
        query.onsuccess = () => resolve(query.result)
        query.onerror = () => reject(query.error)
      })
    } finally {
      database.close()
    }
  })
  expect(saved).toMatchObject({ id: before.reviewRecord.id, index: before.reviewRecord.index, isFinished: false })
  expect(saved.words.map((item: { name: string }) => item.name)).toEqual(
    before.reviewRecord.words.map((item: { name: string }) => item.name),
  )
})

test('completion confirms local settlement once and continuation starts a new block', async ({ page }) => {
  await openStudy(page, 960203, true)
  await finishReview(page)
  await expect(page.getByRole('status').filter({ hasText: '本轮学习记录已保存在本机' })).toBeVisible()
  await expect(page.locator('.mobile-daily-grid > div').filter({ hasText: '复习已完成' })).toContainText('1 / 1')
  await page.screenshot({ path: '.review-test/mobile-result.png', fullPage: true })
  const first = await dailyState(page)
  expect(first.blockCount).toBe(1)
  expect(first.completedBlockIds).toHaveLength(1)
  await page.waitForTimeout(500)
  expect((await dailyState(page)).blockCount).toBe(1)
  await page.getByRole('button', { name: '继续今日学习' }).click()
  await expect(practice(page)).toBeVisible({ timeout: 30_000 })
  expect((await readReviewModeInfo(page)).reviewRecord.id).not.toBe(960203)
  expect((await dailyState(page)).completedBlockIds).toEqual(first.completedBlockIds)
})

test('local settlement failure never claims saved; retry commits one block', async ({ page }) => {
  await openStudy(page, 960204, true)
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    ;(window as any).__restoreDailyWrite = () => {
      Storage.prototype.setItem = original
    }
    Storage.prototype.setItem = function (key, value) {
      if (key === 'qwerty.learn.dailySession.v1.cet4') throw new DOMException('Injected settlement failure', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await finishReview(page)
  await expect(page.getByRole('alert')).toContainText('学习记录还未确认完整保存')
  await expect(page.getByRole('button', { name: '返回手机菜单' })).toBeDisabled()
  await expect(page.getByText('本轮学习记录已保存在本机。', { exact: true })).toHaveCount(0)
  await page.evaluate(() => (window as any).__restoreDailyWrite())
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '返回手机菜单' })).toBeEnabled()
  expect((await dailyState(page)).blockCount).toBe(1)
})

test('new menu, library and settings stay within 320px width with accessible controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  for (const route of ['/mobile', '/mobile/library', '/mobile/settings']) {
    await page.goto(route)
    await expect(page.locator('main.mobile-app')).toBeVisible({ timeout: 30_000 })
    const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }))
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.viewport + 1)
    const targetSizes = await page
      .locator('.mobile-start-link, .mobile-library-list button, .mobile-detail-page select, .mobile-detail-page input')
      .evaluateAll((elements) =>
        elements
          .filter((element) => (element as HTMLInputElement).type !== 'checkbox')
          .map((element) => element.getBoundingClientRect().height),
      )
    expect(targetSizes.every((height) => height >= 44)).toBe(true)
    await page.screenshot({ path: '.review-test/mobile-' + route.split('/').pop() + '-320.png', fullPage: true })
  }
})

test('today progress uses saved independent evidence and remains frozen after changing the next daily target', async ({ page }) => {
  await openStudy(page, 960205, true)
  await finishReview(page)
  await page.getByRole('button', { name: '返回手机菜单' }).click()
  await expect(page.locator('[data-mobile-daily-progress]')).toBeVisible()
  await expect(page.locator('.mobile-daily-grid > div').filter({ hasText: '复习已完成' })).toContainText('1 / 1')
  const original = await dailyState(page)
  await page.getByRole('link', { name: /^设置/ }).click()
  await page.getByLabel('每日新词目标').fill('5')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByRole('status')).toContainText('设置已保存在本机')
  await page.getByRole('link', { name: '返回首页' }).click()
  expect((await dailyState(page)).sessionId).toBe(original.sessionId)
  expect((await dailyState(page)).plannedNewWords).toBe(original.plannedNewWords)
  await expect(page.locator('.mobile-daily-grid > div').filter({ hasText: '新词达标' })).toContainText('0 / 32')
})
