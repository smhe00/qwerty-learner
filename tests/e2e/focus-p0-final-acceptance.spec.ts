import { expect, test } from '@playwright/test'
import {
  reviewWords,
  seedReviewSession,
  startTyping,
  waitForActiveLearnSession,
  waitForRenderedWord,
  waitForReviewIndex,
} from './review-flow-harness'

test('P0 keeps active Learn cold probe and Block completion functional', async ({ page }) => {
  test.setTimeout(90_000)
  await seedReviewSession(page, reviewWords, 901208)
  await page.goto('/learn')
  await waitForActiveLearnSession(page)
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  await expect(page.locator('.focus-study-stage')).toBeVisible()
  await expect(page.locator('[data-learn-live-stats]')).toHaveClass(/focus-stats-strip/)
  // Complete without hint so the Block's original independent-review gate
  // remains unchanged and can be assessed on its own merits.
  await page.keyboard.type('cancel')
  await waitForReviewIndex(page, 1)
  await waitForRenderedWord(page, 'analyse')
  await page.keyboard.type('analyse')
  await waitForReviewIndex(page, 2)
  await waitForRenderedWord(page, 'numerous')
  await page.keyboard.type('numerous')
  const pause = page.locator('[data-learn-result-screen]')
  await expect(pause).toBeVisible({ timeout: 20_000 })
  await expect(pause.locator('.focus-overlay-panel')).toBeVisible()
  await expect(pause.getByRole('button', { name: '按任意键继续', exact: true })).toBeVisible()
  await page.screenshot({
    path: 'test-results/focus-ui/learn-block-complete-light.png',
    fullPage: false,
    animations: 'disabled',
    timeout: 15_000,
  })
})

test('P0 retains ESC full-reveal semantics in the active Focus study area', async ({ page }) => {
  test.setTimeout(60_000)
  await seedReviewSession(page, reviewWords, 901209)
  await page.goto('/learn')
  await waitForActiveLearnSession(page)
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  const word = page.locator('[data-review-hint-level]').first()
  await page.keyboard.press('Escape')
  await expect(word).toHaveAttribute('data-review-hint-level', '3')
  await expect(word).toHaveText('cancel')
})

test('P0 settings and donation dialogs share surface tokens, remain usable on narrow viewports', async ({ page }) => {
  test.setTimeout(65_000)
  await page.setViewportSize({ width: 760, height: 680 })
  await page.goto('/typing')
  const openSettings = page.getByRole('button', { name: '打开设置对话框' })
  await expect(openSettings).toBeVisible({ timeout: 20_000 })
  await openSettings.click()
  // Match the actual Settings dialog, not unrelated dormant HeadlessUI panels.
  const settings = page.locator('[role="dialog"]:has(button[aria-label="关闭设置"])')
  await expect(settings).toBeVisible()
  await expect(settings.locator('.focus-overlay-panel')).toBeVisible()
  const bounds = await settings.locator('.focus-overlay-panel').boundingBox()
  expect(bounds).toBeTruthy()
  expect(bounds!.width).toBeLessThanOrEqual(760)
  await expect(settings.getByText('记忆参数', { exact: true })).toBeVisible()
  await page.screenshot({
    path: 'test-results/focus-ui/settings-light-760.png',
    fullPage: false,
    animations: 'disabled',
    timeout: 15_000,
  })
  await settings.getByRole('button', { name: '关闭设置' }).click()
  await expect(settings).toHaveCount(0)

  await page.getByRole('button', { name: '开关深色模式' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await openSettings.click()
  await expect(settings.locator('.focus-overlay-panel')).toBeVisible()
  await page.screenshot({
    path: 'test-results/focus-ui/settings-dark-760.png',
    fullPage: false,
    animations: 'disabled',
    timeout: 15_000,
  })
  await settings.getByRole('button', { name: '关闭设置' }).click()

  await page.getByRole('button', { name: '打开赞赏页面' }).click()
  const donate = page.locator('[role="dialog"]:has-text("赞赏 Qwerty Plus")')
  await expect(donate).toBeVisible()
  await expect(donate.locator('.focus-overlay-panel')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(donate).toHaveCount(0)
})

test('P0 reduced-motion removes ornamental animations without hiding the mode switch', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/typing')
  const mode = page.getByRole('button', { name: 'Typing', exact: true })
  await expect(mode).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })
  const css = await mode.evaluate(element => ({
    duration: getComputedStyle(element).transitionDuration,
    animation: getComputedStyle(element).animationDuration,
  }))
  expect(parseFloat(css.duration)).toBeLessThanOrEqual(0.001)
  expect(parseFloat(css.animation)).toBeLessThanOrEqual(0.001)
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Learn', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
