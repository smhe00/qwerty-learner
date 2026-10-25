import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function home(page: Page) {
  await page.goto('/mobile')
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
}

async function seedArtAccess(page: Page) {
  // Synthetic completed attempts on three past LOCAL days; no award bypass.
  await page.addScriptTag({ type: 'module', content: `
    import { db } from '/src/utils/db/core.ts';
    await db.wordRecords.bulkAdd([1, 2, 3].map(days => {
      const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - days);
      return {dict:'cet4',word:'navigation-fixture-' + days,chapter:-1,
        timeStamp:Math.floor(date.getTime()/1000),timing:[200],wrongCount:0,
        mistakes:{},sourceMode:'learn',learnItemKind:'acquisition'};
    }));
    window.__achievementNavigationSeeded = true;
  ` })
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__achievementNavigationSeeded))).toBe(true)
}

async function evidence(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      const names = ['wordRecords', 'chapterRecords', 'reviewRecords', 'reviewWordStates', 'achievementEvents', 'achievementStates']
      const tx = db.transaction(names, 'readonly')
      const rows = await Promise.all(names.map(name => new Promise(resolve => {
        const read = tx.objectStore(name).getAll()
        read.onsuccess = () => resolve([name, read.result])
        read.onerror = () => { tx.abort(); resolve(null) }
      })))
      if (rows.some(row => row === null)) throw new Error('Synthetic evidence read failed')
      return { rows, dictionary: localStorage.getItem('currentDict'), checkpoint: localStorage.getItem('reviewModeInfo') }
    } finally { db.close() }
  })
}

async function oneMobileReturn(page: Page) {
  const back = page.getByRole('button', { name: '返回手机首页', exact: true })
  await expect(back).toHaveCount(1)
  await expect(back).toBeVisible()
  // Assert absence, not CSS invisibility: no duplicate accessible/focusable exit.
  await expect(page.locator('.focus-achievements-back, .song-v2-close')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '返回 Learn', exact: true })).toHaveCount(0)
  const heading = page.locator('[data-mobile-achievement-header]')
  await expect(heading).toHaveCount(1)
  await expect(page.locator('header')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(heading).not.toContainText(/QWERTY/i)
  await expect(page.getByText('QWERTY Plus · 成就雅集', { exact: true })).toHaveCount(0)
  const titleBox = await heading.locator('h1').boundingBox()
  const backBox = await back.boundingBox()
  expect(titleBox).not.toBeNull()
  expect(backBox).not.toBeNull()
  if (!titleBox || !backBox) throw new Error('Missing mobile heading geometry')
  expect(backBox.width).toBeGreaterThanOrEqual(44)
  expect(backBox.height).toBeGreaterThanOrEqual(44)
  expect(backBox.x + backBox.width).toBeLessThanOrEqual(titleBox.x)
  expect(Math.abs(backBox.y + backBox.height / 2 - titleBox.y - titleBox.height / 2)).toBeLessThan(2)
  await expect(back).toHaveCSS('border-top-width', '0px')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

test.describe('menu completion: mobile achievement return ownership', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('Focus menu, reload, rotation and legacy entry have one return without data changes', async ({ page }) => {
    await home(page)
    const before = await evidence(page)
    await page.getByRole('link', { name: /^成就/ }).tap()
    await expect(page.locator('[data-focus-achievement-gallery]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.focus-achievements-item:disabled')).toHaveCount(34)
    for (const viewport of [{ width: 320, height: 640 }, { width: 900, height: 500 }]) {
      await page.setViewportSize(viewport)
      await oneMobileReturn(page)
      await expect(page).toHaveURL(/\/mobile\/achievements$/)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'test-results/achievement-unified-heading-focus.png', animations: 'disabled' })
    // Exercise existing dark CSS tokens without persisting a preference.
    await page.locator('[data-focus-achievement-gallery]').evaluate(el => el.setAttribute('data-theme', 'dark'))
    await oneMobileReturn(page)
    await page.screenshot({ path: 'test-results/achievement-unified-heading-focus-dark.png', animations: 'disabled' })
    await page.reload()
    await expect(page.locator('[data-focus-achievement-gallery]')).toBeVisible()
    await oneMobileReturn(page)
    await page.getByRole('button', { name: '返回手机首页' }).tap()
    await expect(page.locator('[data-mobile-menu]')).toBeVisible()
    await page.goto('/achievements')
    await expect(page.locator('[data-focus-achievement-gallery]')).toBeVisible()
    await oneMobileReturn(page)
    await page.getByRole('button', { name: '返回手机首页' }).tap()
    await expect(page).toHaveURL(/\/mobile$/)
    expect(await evidence(page)).toEqual(before)
  })

  test('Song keeps view switching and detail close, but never a second page exit', async ({ page }) => {
    await home(page)
    await seedArtAccess(page)
    const before = await evidence(page)
    await page.getByRole('link', { name: /^成就/ }).tap()
    await page.getByRole('button', { name: '开启宋韵雅藏' }).tap()
    await expect(page.locator('[data-song-achievement-gallery]')).toBeVisible()
    await oneMobileReturn(page)
    await expect(page.locator('.song-v2-card:disabled')).toHaveCount(34)
    await expect(page.locator('[data-mobile-achievement-header]').getByLabel('已解锁 0/34')).toBeVisible()
    for (const width of [320, 900]) {
      await page.setViewportSize({ width, height: 500 })
      await oneMobileReturn(page)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'test-results/achievement-unified-heading-song.png', animations: 'disabled' })
    await page.getByRole('button', { name: '夜卷', exact: true }).tap()
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page.locator('[data-song-achievement-gallery]')).toHaveAttribute('data-song-theme', 'dark')
    await oneMobileReturn(page)
    await page.screenshot({ path: 'test-results/achievement-unified-heading-song-dark.png', animations: 'disabled' })
    await page.getByRole('button', { name: '展卷演示' }).tap()
    await expect(page.getByRole('dialog', { name: /成就藏品/ })).toBeVisible()
    await page.getByRole('button', { name: '关闭藏品', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: /成就藏品/ })).toHaveCount(0)
    await expect(page).toHaveURL(/\/mobile\/achievements$/)
    await page.getByRole('button', { name: '返回简洁版', exact: true }).tap()
    await expect(page.locator('[data-focus-achievement-gallery]')).toBeVisible()
    await oneMobileReturn(page)
    await page.getByRole('button', { name: '返回手机首页' }).tap()
    await expect(page.locator('[data-mobile-menu]')).toBeVisible()
    expect(await evidence(page)).toEqual(before)
  })
})

test.describe('menu completion: desktop achievement navigation', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false })

  test('standalone Focus and Song retain their existing Learn return', async ({ page }) => {
    await page.goto('/achievements')
    await expect(page.locator('[data-focus-achievement-gallery]')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: '返回 Learn', exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: '返回手机首页' })).toHaveCount(0)
    await expect(page.locator('[data-mobile-achievement-header]')).toHaveCount(0)
    await expect(page.locator('.focus-achievements-header')).toContainText('QWERTY PLUS / PROGRESS')
    await page.getByRole('button', { name: '返回 Learn', exact: true }).click()
    await expect(page).toHaveURL(/\/learn$/)
    await page.goto('/achievements')
    await expect(page.locator('[data-focus-achievement-gallery]')).toBeVisible()
    await seedArtAccess(page)
    await page.getByRole('button', { name: '开启宋韵雅藏' }).click()
    await expect(page.locator('[data-song-achievement-gallery]')).toBeVisible()
    await expect(page.locator('.song-v2-close')).toHaveCount(1)
    await expect(page.locator('[data-mobile-achievement-header]')).toHaveCount(0)
    await expect(page.locator('.song-v2-header')).toContainText('QWERTY PLUS · COLLECTION')
    await page.getByRole('button', { name: '返回 Learn', exact: true }).click()
    await expect(page).toHaveURL(/\/learn$/)
  })
})
