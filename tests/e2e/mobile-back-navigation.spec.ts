import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

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
      const rows = await Promise.all(names.map(name => new Promise((resolve, reject) => {
        const read = tx.objectStore(name).getAll()
        read.onsuccess = () => resolve([name, read.result])
        read.onerror = () => reject(read.error)
      })))
      return { rows, dictionary: localStorage.getItem('currentDict'), checkpoint: localStorage.getItem('reviewModeInfo') }
    } finally { db.close() }
  })
}

for (const item of [
  { path: 'library', menu: /^词库/, title: '选择词库' },
  { path: 'settings', menu: /^设置/, title: '学习设置' },
  { path: 'history', menu: /^学习记录/, title: '学习记录' },
  { path: 'data', menu: /^账号与云同步/, title: '账号与云同步' },
]) {
  test('menu completion: unified chevron, accessible return and unchanged records on ' + item.path, async ({ page }) => {
    await page.goto('/mobile')
    await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
    await page.addScriptTag({ type: 'module', content: `
      import { db } from '/src/utils/db/core.ts';
      await db.wordRecords.add({dict:'cet4',word:'navigation-only-fixture',chapter:-1,
        timeStamp:Math.floor(Date.now()/1000)-86400,timing:[200],wrongCount:0,mistakes:{},
        sourceMode:'learn',learnItemKind:'acquisition'});
      window.__backNavigationSeeded = true;
    ` })
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__backNavigationSeeded))).toBe(true)
    const before = await evidence(page)
    await page.getByRole('link', { name: item.menu }).tap()
    await expect(page).toHaveURL(new RegExp('/mobile/' + item.path + '$'))
    const header = page.locator('.mobile-detail-header')
    const back = header.getByRole('link', { name: '返回首页', exact: true })
    await expect(header.getByRole('heading', { name: item.title, exact: true })).toBeVisible()
    await expect(page.locator('[data-mobile-back-control]')).toHaveCount(1)
    await expect(back).toHaveAttribute('href', '/mobile')
    await expect(back).toHaveText('')
    await expect(back.locator('svg')).toHaveAttribute('aria-hidden', 'true')
    await expect(back.locator('svg')).toHaveClass(/lucide-chevron-left/)
    await page.screenshot({ path: 'test-results/mobile-back-' + item.path + '.png' })
    for (const viewport of [{ width: 320, height: 640 }, { width: 900, height: 500 }]) {
      await page.setViewportSize(viewport)
      await expect(back).toBeVisible()
      await expect(page).toHaveURL(new RegExp('/mobile/' + item.path + '$'))
      const button = await back.boundingBox()
      const title = await header.locator('h1').boundingBox()
      expect(button!.width).toBeGreaterThanOrEqual(44)
      expect(button!.height).toBeGreaterThanOrEqual(44)
      expect(button!.x + button!.width).toBeLessThanOrEqual(title!.x)
      expect(Math.abs(button!.y + button!.height / 2 - title!.y - title!.height / 2)).toBeLessThan(2)
      expect(await back.evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    await page.setViewportSize({ width: 320, height: 640 })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await expect(back).toBeVisible()
    await page.screenshot({ path: 'test-results/mobile-back-' + item.path + '-dark.png' })
    expect(await evidence(page)).toEqual(before)
    await page.reload()
    await expect(back).toBeVisible()
    await back.tap()
    await expect(page.locator('[data-mobile-menu]')).toBeVisible()
    expect(await evidence(page)).toEqual(before)
    // Preserve link semantics: keyboard activation still returns to Home.
    await page.getByRole('link', { name: item.menu }).tap()
    await expect(back).toBeVisible()
    await back.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-mobile-menu]')).toBeVisible()
    expect(await evidence(page)).toEqual(before)
    // Verify the same SVG is used by the achievement page's button variant.
    await page.getByRole('link', { name: /^成就/ }).tap()
    const achievementBack = page.getByRole('button', { name: '返回手机首页', exact: true })
    await expect(achievementBack).toHaveAttribute('data-mobile-back-control', '')
    await expect(achievementBack.locator('svg')).toHaveClass(/lucide-chevron-left/)
    await achievementBack.tap()
    await expect(page.locator('[data-mobile-menu]')).toBeVisible()
    expect(await evidence(page)).toEqual(before)
  })
}
