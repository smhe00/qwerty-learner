import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { gotoReviewAppReady } from './review-flow-harness'

const control = (page: Page) => page.locator('header button[data-learn-exercise]')

async function learningSnapshot(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const records = await new Promise<number>((resolve, reject) => {
      const request = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return {
      review: localStorage.getItem('reviewModeInfo'),
      chapter: localStorage.getItem('currentChapter'),
      records,
    }
  })
}

test('one chapter-slot control carries the landing preference into the same paused Learn session', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoReviewAppReady(page, '/typing')
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  const start = page.getByRole('button', { name: '开始 Learn', exact: true })
  await expect(start).toBeEnabled()
  await expect(control(page)).toHaveCount(1)
  await expect(control(page)).toHaveCSS('font-size', '16px')
  await expect(control(page)).toHaveAttribute('aria-label', '学习方式：拼写')
  const landing = await learningSnapshot(page)
  await control(page).click()
  await expect(control(page)).toHaveAttribute('aria-label', '学习方式：轻触')
  expect(await learningSnapshot(page)).toEqual(landing)
  await start.click()
  await expect(page.locator('[data-desktop-tap-study] [data-mobile-word-practice]')).toBeVisible()
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(page.locator('header [data-session-control]')).toHaveAttribute('aria-label', /^(开始|继续)$/)
  const paused = await learningSnapshot(page)
  expect(JSON.parse(paused.review || '{}').reviewRecord?.id).toBeDefined()
  await control(page).focus()
  await page.keyboard.press('Enter')
  await expect(control(page)).toHaveAttribute('aria-label', '学习方式：拼写')
  await expect(control(page)).toBeFocused()
  await expect(page.locator('[data-desktop-tap-study]')).toHaveCount(0)
  await expect(page.locator('header [data-session-control]')).toHaveAttribute('aria-label', /^(开始|继续)$/)
  expect(await learningSnapshot(page)).toEqual(paused)
  await page.screenshot({ path: testInfo.outputPath('pc-spelling-light.png'), fullPage: true })
  await page.keyboard.press('Space')
  await expect(control(page)).toHaveAttribute('aria-label', '学习方式：轻触')
  await expect(page.locator('[data-desktop-tap-study]')).toBeVisible()
  await expect(page.locator('header [data-session-control]')).toHaveAttribute('aria-label', /^(开始|继续)$/)
  expect(await learningSnapshot(page)).toEqual(paused)
  await expect(page.getByRole('button', { name: '切换轻触记忆', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '返回键盘拼写', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('pc-tap-light.png'), fullPage: true })
})

test('chapter-slot control stays aligned and stable at desktop widths in both themes', async ({ page }, testInfo) => {
  await gotoReviewAppReady(page, '/typing')
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  const row = page.locator('header [data-toolbar-row="primary"]')
  const dictionary = row.locator('a[href="/gallery?mode=learn"]')
  const pronunciation = page.locator('header [data-toolbar-row="icons"]').getByRole('button', { name: /发音口音/ })
  for (const dark of [false, true]) {
    if (dark) {
      await page.getByRole('button', { name: '开关深色模式' }).click()
      await expect(page.locator('html')).toHaveClass(/dark/)
    }
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      let originalSize: { width: number; height: number } | null = null
      for (const exercise of ['spelling', 'tap-recall']) {
        await expect(control(page)).toHaveAttribute('data-learn-exercise', exercise)
        await expect(dictionary).toBeVisible()
        await expect(pronunciation).toBeVisible()
        const buttonBox = (await control(page).boundingBox())!
        const dictionaryBox = (await dictionary.boundingBox())!
        const pronunciationBox = (await pronunciation.boundingBox())!
        expect(buttonBox.x).toBeGreaterThanOrEqual(dictionaryBox.x + dictionaryBox.width)
        if (Math.abs(buttonBox.y - pronunciationBox.y) <= 3) {
          expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(pronunciationBox.x)
        } else {
          expect(pronunciationBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height)
        }
        const size = { width: buttonBox.width, height: buttonBox.height }
        if (originalSize) expect(size).toEqual(originalSize)
        originalSize = size
        const viewport = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }))
        expect(viewport.content).toBeLessThanOrEqual(viewport.width + 1)
        await expect(control(page)).toHaveAttribute('title', /点击切换到/)
        if (width === 1440) {
          await page.screenshot({ path: testInfo.outputPath('pc-header-' + exercise + (dark ? '-dark.png' : '-light.png')), fullPage: true })
        }
        await control(page).click()
        await expect(control(page)).not.toBeFocused()
      }
    }
  }
})

test('Typing keeps its chapter selector and mobile never renders the desktop switcher', async ({ page }) => {
  await gotoReviewAppReady(page, '/typing')
  const chapter = page.getByRole('button', { name: /^第 \d+ 章$/ })
  await expect(chapter).toBeVisible()
  const previousChapter = await chapter.innerText()
  await expect(control(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await control(page).click()
  await page.getByRole('button', { name: 'Typing', exact: true }).click()
  await expect(chapter).toHaveText(previousChapter)
  await expect(control(page)).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/mobile')
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await expect(page.locator('[data-learn-exercise]')).toHaveCount(0)
})
