import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { reviewWords, seedAcquisitionSession } from './review-flow-harness'

// Run against the production bundle: the late Tailwind 3.3.2 reset used by
// yarn.lock can hide a button that remains visible in the development server.
test.use({ hasTouch: true, isMobile: true })

async function visibleAction(button: Locator) {
  await expect(button).toBeVisible()
  await expect(button).toBeInViewport({ ratio: 1 })
  await expect(button).toBeEnabled()
  const style = await button.evaluate(el => {
    const css = getComputedStyle(el)
    const rgb = (value: string) => (value.match(/[\d.]+/g) || []).map(Number)
    const luminance = (channels: number[]) => channels.slice(0, 3).reduce((sum, channel, i) => {
      const value = channel / 255
      return sum + (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i]
    }, 0)
    const bg = rgb(css.backgroundColor), fg = rgb(css.color)
    const a = luminance(bg), b = luminance(fg)
    return { opacity: Number(css.opacity), alpha: bg[3] ?? 1, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), height: el.getBoundingClientRect().height }
  })
  expect(style.alpha).toBe(1)
  expect(style.opacity).toBe(1)
  expect(style.contrast).toBeGreaterThanOrEqual(4.5)
  expect(style.height).toBeGreaterThanOrEqual(44)
}

async function attemptCount(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<number>((resolve, reject) => {
        const query = db.transaction('wordRecords').objectStore('wordRecords').count()
        query.onsuccess = () => resolve(query.result)
        query.onerror = () => reject(query.error)
      })
    } finally { db.close() }
  })
}

for (const [width, height, theme, audio, entry] of [
  [320, 568, 'light', 'blocked', 'home'],
  [390, 844, 'light', 'pending', 'reload'],
  [390, 844, 'dark', 'blocked', 'home'],
  [844, 390, 'dark', 'pending', 'reload'],
  [1024, 600, 'light', 'blocked', 'home'],
  [1024, 600, 'dark', 'pending', 'reload'],
] as const) {
  test(`new-word action stays readable and advances once: ${width}x${height} ${theme} ${audio} ${entry}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height })
    await page.addInitScript(({ dark, behavior }) => {
      localStorage.setItem('isOpenDarkModeAtom', JSON.stringify(dark))
      HTMLMediaElement.prototype.play = () => behavior === 'blocked'
        ? Promise.reject(new DOMException('autoplay blocked', 'NotAllowedError'))
        : new Promise<void>(() => {})
    }, { dark: theme === 'dark', behavior: audio })
    await seedAcquisitionSession(page, reviewWords, 980108, 'exposure')
    if (entry === 'home') {
      await page.goto('/mobile')
      await page.locator('[data-mobile-menu] .mobile-start-link').tap()
    } else {
      await page.goto('/mobile/study')
      await expect(page.locator('[data-mobile-word-practice]')).toBeVisible()
      await page.reload()
    }
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/)
    const card = page.locator('[data-mobile-word-practice]')
    const next = card.getByRole('button', { name: '继续学习', exact: true })
    await visibleAction(next)
    await expect(card.getByText('看完后继续', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('new-word-action.png') })
    const word = await card.getAttribute('data-mobile-word')
    expect(await attemptCount(page)).toBe(0)
    await next.tap()
    if (entry === 'reload') {
      await card.getByRole('button', { name: '停留查看', exact: true }).tap()
      const manualNext = card.locator('[data-mobile-manual-next]')
      await visibleAction(manualNext)
      await manualNext.tap()
    }
    await expect(card).not.toHaveAttribute('data-mobile-word', word!, { timeout: 10_000 })
    expect(await attemptCount(page)).toBe(1)
  })
}
