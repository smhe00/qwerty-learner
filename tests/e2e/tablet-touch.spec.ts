import { readReviewModeInfo, reviewWords, seedAcquisitionSession } from './review-flow-harness'
import { expect, test } from '@playwright/test'

test.describe('wide touch devices', () => {
  // Desktop UA/viewport semantics reproduce tablets requesting a desktop site.
  test.use({ hasTouch: true, isMobile: false, viewport: { width: 1024, height: 768 } })

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1366, height: 1024 },
  ]) {
    test(`landscape ${viewport.width}px opens touch learning without a keyboard`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.addInitScript(() => {
        HTMLMediaElement.prototype.play = () => Promise.resolve()
      })
      await seedAcquisitionSession(page, reviewWords, 982801 + viewport.width, 'exposure')
      await page.goto('/')
      await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches)).toBe(true)
      await page.getByRole('link', { name: /^(开始|继续)手机学习$/ }).tap()
      const card = page.locator('[data-mobile-word-practice]')
      await expect(card).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('input, textarea')).toHaveCount(0)
      const firstWord = await card.getAttribute('data-mobile-word')
      await card.getByRole('button', { name: '继续学习', exact: true }).tap()
      await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
      await expect(card.locator('[data-mobile-feedback]')).toHaveCount(0, { timeout: 10_000 })
      await expect(card).not.toHaveAttribute('data-mobile-word', firstWord!)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    })
  }

  test('rotation and unfolding preserve the active card, answer and checkpoint', async ({ page }) => {
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = () => Promise.resolve()
    })
    await seedAcquisitionSession(page, reviewWords, 982803)
    await page.goto('/mobile/study')
    const card = page.locator('[data-mobile-word-practice]')
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.locator('[data-mobile-grade="hard"]').tap()
    await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
    const before = await readReviewModeInfo(page)
    const word = await card.getAttribute('data-mobile-word')
    const originalCard = await card.elementHandle()
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1366, height: 768 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(viewport)
      await expect(page).toHaveURL(/\/mobile\/study$/)
      await expect(card).toHaveAttribute('data-mobile-word', word!)
      await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
      expect(await originalCard!.evaluate((element) => element === document.querySelector('[data-mobile-word-practice]'))).toBe(true)
      expect(await readReviewModeInfo(page)).toEqual(before)
      const actions = card.locator('[data-mobile-action-zone]')
      const bounds = (await actions.boundingBox())!
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1)
    }
  })
})

test.describe('mouse-first desktop and explicit touch choice', () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1280, height: 800 } })

  test('wide desktop retains Learn and Typing routes', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/\/learn$/)
    await expect(page.locator('[data-mobile-menu]')).toHaveCount(0)
    await page.goto('/typing')
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
    await expect(page).toHaveURL(/\/typing$/)
  })

  test('explicit touch home survives width changes even with a mouse', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/mobile')
    await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('[data-mobile-menu]')).toBeVisible()
    await expect(page).toHaveURL(/\/mobile$/)
    await page.reload()
    await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  })
})
