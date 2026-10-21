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


test('Mobile prioritizes full word at top; long explanations truncate below the example', async ({ page }) => {
  await mockWordPronunciation(page)
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/mobile/study')
  const practice = page.locator('[data-mobile-word-practice]')
  await expect(practice).toBeVisible({ timeout: 45_000 })

  if (await practice.getAttribute('data-mobile-task') === 'recall') {
    await page.getByRole('button', { name: '显示答案' }).click()
  }

  const word = practice.locator('[data-mobile-word-slot] .mobile-practice-word')
  if (await word.count() > 0) {
    const before = await word.boundingBox()
    expect(before).not.toBeNull()
    const result = await word.evaluate((element) => {
      const root = element.closest('[data-mobile-reading]')
      const wordSlot = root?.querySelector('[data-mobile-word-slot]')
      const exampleSlot = root?.querySelector('[data-mobile-example-slot]')
      const meaningSlot = root?.querySelector('[data-mobile-meaning-slot]')
      const meaning = meaningSlot?.querySelector('.mobile-practice-meaning')
      if (meaning) meaning.textContent = '非常冗长的中文释义与补充说明；'.repeat(100)
      const rect = element.getBoundingClientRect()
      const slotRect = wordSlot?.getBoundingClientRect()
      const readingRect = root?.getBoundingClientRect()
      const exampleRect = exampleSlot?.getBoundingClientRect()
      const meaningRect = meaningSlot?.getBoundingClientRect()
      const meaningLine = meaning ? parseFloat(getComputedStyle(meaning).lineHeight) : 0
      return {
        wordTop: rect.top, wordBottom: rect.bottom, wordVisibleHeight: element.scrollHeight,
        wordBoxHeight: rect.height,
        wordOverflow: element.scrollWidth - element.clientWidth,
        readingTop: readingRect?.top ?? 0, readingBottom: readingRect?.bottom ?? 0,
        slotTop: slotRect?.top ?? 0,
        exampleCenter: exampleRect ? (exampleRect.top + exampleRect.bottom) / 2 : 0,
        meaningTop: meaningRect?.top ?? 0,
        meaningHeight: meaning?.getBoundingClientRect().height ?? 0,
        meaningLine,
      }
    })
    const after = await word.boundingBox()
    expect(after).not.toBeNull()
    expect(after!.y).toBeCloseTo(before!.y, 0)
    expect(result.wordTop).toBeGreaterThanOrEqual(result.readingTop - 1)
    expect(result.wordBottom).toBeLessThanOrEqual(result.readingBottom + 1)
    expect(result.wordBoxHeight).toBeGreaterThanOrEqual(result.wordVisibleHeight - 1)
    expect(result.wordOverflow).toBeLessThanOrEqual(1)
    expect(result.meaningTop).toBeGreaterThan(result.wordBottom)
    expect(result.exampleCenter).toBeGreaterThan(result.wordBottom)
    if (result.meaningLine > 0) expect(result.meaningHeight).toBeLessThanOrEqual(result.meaningLine * 2 + 2)
  }

  await expect(page.locator('[data-mobile-action-zone]')).toBeVisible()
})
