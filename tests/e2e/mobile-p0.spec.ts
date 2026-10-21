import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function countWordRecords(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<number>((resolve, reject) => {
        const count = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').count()
        count.onsuccess = () => resolve(count.result)
        count.onerror = () => reject(count.error)
      })
    } finally { db.close() }
  })
}

async function mockWordPronunciation(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play
    ;(window as Window & { __mobileAudioAutoCalls?: number }).__mobileAudioAutoCalls = 0
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes('dictvoice')) {
        const win = window as Window & { __mobileAudioAutoCalls?: number }
        win.__mobileAudioAutoCalls = (win.__mobileAudioAutoCalls ?? 0) + 1
        this.dispatchEvent(new Event('playing'))
        return Promise.resolve()
      }
      return original.call(this)
    }
  })
}

test.use({ viewport: { width: 390, height: 844 } })

test('Mobile keeps the independent app menu without Typing controls', async ({ page }) => {
  await page.goto('/mobile')
  const menu = page.locator('[data-mobile-menu]')
  await expect(menu).toBeVisible({ timeout: 25_000 })
  await expect(menu.getByRole('heading', { name: /QWERTY/ })).toBeVisible()
  await expect(menu.getByRole('link', { name: '开始手机学习' })).toBeVisible()
  await expect(menu.getByText('账号与云同步', { exact: true })).toBeVisible()
  await expect(menu.getByText('设置', { exact: true })).toBeVisible()
  await expect(menu.getByText('即将开放', { exact: true })).toHaveCount(5)
  await expect(page.locator('header nav.focus-header-nav')).toHaveCount(0)
  const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(bounds.width).toBeLessThanOrEqual(bounds.viewport + 1)
})

test('Mobile single-tap choice or two-tap recall saves then advances automatically', async ({ page }) => {
  await mockWordPronunciation(page)
  await page.goto('/mobile/study')
  const taskView = page.locator('[data-mobile-word-practice]')
  await expect(taskView).toBeVisible({ timeout: 45_000 })
  await expect(page.getByRole('button', { name: '暂停学习' })).toBeVisible()
  await expect(page.locator('input, textarea, [data-typing-input-control]')).toHaveCount(0)

  const task = await taskView.getAttribute('data-mobile-task')
  const before = await countWordRecords(page)
  if (task === 'exposure') {
    await expect.poll(async () => page.evaluate(() =>
      (window as Window & { __mobileAudioAutoCalls?: number }).__mobileAudioAutoCalls ?? 0,
    )).toBeGreaterThan(0)
    await page.getByRole('button', { name: '继续学习' }).click()
  } else if (task === 'recall') {
    await page.getByRole('button', { name: '显示答案' }).click()
    await expect(page.locator('[data-mobile-answer-revealed]')).toBeVisible()
    await expect(page.locator('[data-mobile-grade]')).toHaveCount(3)
    expect(await countWordRecords(page)).toBe(before)
    await page.locator('[data-mobile-grade="good"]').click()
  } else {
    if (task === 'audio') {
      await expect.poll(async () => page.evaluate(() =>
        (window as Window & { __mobileAudioAutoCalls?: number }).__mobileAudioAutoCalls ?? 0,
      )).toBeGreaterThan(0)
    }
    await page.locator('[data-mobile-choice]').first().click()
  }

  await expect(page.locator('[data-mobile-feedback]')).toBeVisible()
  expect(await countWordRecords(page)).toBe(before + 1)
  await expect(page.getByRole('button', { name: '确认选择' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '继续', exact: true })).toHaveCount(0)
  await expect(page.locator('[data-mobile-feedback]')).toHaveCount(0, { timeout: 7_000 })
  await expect(page.locator('[data-mobile-word-practice], [data-mobile-complete]')).toBeVisible()
})

test('Mobile tap targets remain anchored at the bottom thumb zone', async ({ page }) => {
  await mockWordPronunciation(page)
  await page.goto('/mobile/study')
  await expect(page.locator('[data-mobile-word-practice]')).toBeVisible({ timeout: 45_000 })
  const action = page.locator('[data-mobile-action-zone]')
  await expect(action).toBeVisible()
  const metrics = await action.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight }
  })
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewport + 1)
  expect(metrics.bottom).toBeGreaterThan(metrics.viewport * 0.72)
  expect(metrics.top).toBeGreaterThan(metrics.viewport * 0.54)
  await expect(page.locator('input, textarea')).toHaveCount(0)
})

test('Mobile pause freezes its word and resume does not open a keyboard', async ({ page }) => {
  await mockWordPronunciation(page)
  await page.goto('/mobile/study')
  await expect(page.locator('[data-mobile-word-practice]')).toBeVisible({ timeout: 45_000 })
  await expect(page.getByRole('button', { name: '暂停学习' })).toBeVisible()
  await page.getByRole('button', { name: '暂停学习' }).click()
  await expect(page.locator('[data-mobile-paused]')).toBeVisible()
  await expect(page.locator('input, textarea')).toHaveCount(0)
  await page.locator('[data-mobile-paused]').getByRole('button', { name: '继续学习' }).click()
  await expect(page.locator('[data-mobile-paused]')).toHaveCount(0)
  await expect(page.locator('[data-mobile-word-practice]')).toBeVisible()
})


test('Mobile narrow screens keep the actions visible without horizontal scroll', async ({ page }) => {
  await mockWordPronunciation(page)
  for (const width of [320, 360, 430]) {
    await page.setViewportSize({ width, height: 740 })
    await page.goto('/mobile/study')
    await expect(page.locator('[data-mobile-word-practice]')).toBeVisible({ timeout: 45_000 })
    const bounds = await page.evaluate(() => {
      const footer = document.querySelector('[data-mobile-action-zone]')?.getBoundingClientRect()
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        footerBottom: footer?.bottom ?? 0,
        footerTop: footer?.top ?? 0,
      }
    })
    expect(bounds.pageWidth).toBeLessThanOrEqual(bounds.viewportWidth + 1)
    expect(bounds.footerBottom).toBeLessThanOrEqual(bounds.viewportHeight + 1)
    expect(bounds.footerBottom).toBeGreaterThan(bounds.viewportHeight * .72)
    expect(bounds.footerTop).toBeGreaterThan(bounds.viewportHeight * .5)
  }
})
