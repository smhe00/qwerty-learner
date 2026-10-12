import { expect, test } from '@playwright/test'
import {
  reviewWords,
  seedReviewSession,
  startTyping,
  waitForActiveLearnSession,
  waitForRenderedWord,
  waitForReviewIndex,
} from './review-flow-harness'

test('P1 uses quiet wrong-word feedback without changing ESC or character evidence', async ({ page }) => {
  test.setTimeout(70_000)
  await seedReviewSession(page, reviewWords, 901212)
  await page.goto('/learn')
  await waitForActiveLearnSession(page)
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  const word = page.locator('[data-typing-word="cancel"]')
  await expect(page.locator('.focus-word-layout')).toBeVisible()
  await expect(word).toHaveAttribute('data-typing-has-wrong', 'false')
  await page.keyboard.type('x')
  await expect(word).toHaveAttribute('data-typing-has-wrong', 'true')
  const feedback = await word.evaluate(node => ({
    duration: getComputedStyle(node).animationDuration,
    name: getComputedStyle(node).animationName,
  }))
  expect(parseFloat(feedback.duration)).toBeGreaterThan(0)
  expect(parseFloat(feedback.duration)).toBeLessThanOrEqual(0.3)
  expect(feedback.name).toContain('focusWrongNudge')
  await page.keyboard.press('Escape')
  await expect(word).toHaveAttribute('data-review-hint-level', '3')
})

test('P1 Block milestone keeps exactly five existing metrics and Continue behavior', async ({ page }) => {
  test.setTimeout(90_000)
  await seedReviewSession(page, reviewWords, 901213)
  await page.goto('/learn')
  await waitForActiveLearnSession(page)
  await startTyping(page)
  for (const [i, target] of ['cancel', 'analyse', 'numerous'].entries()) {
    await waitForRenderedWord(page, target)
    await page.keyboard.type(target)
    if (i < 2) await waitForReviewIndex(page, i + 1)
  }
  const result = page.locator('[data-learn-result-screen]')
  await expect(result).toBeVisible({ timeout: 20_000 })
  const bar = result.getByRole('progressbar', { name: '今日学习完成进度' })
  await expect(bar).toBeVisible()
  await expect(bar).toHaveAttribute('aria-valuemin', '0')
  await expect(bar).toHaveAttribute('aria-valuemax', '100')
  await expect(result.locator('[data-focus-result-metrics] .focus-result-metric')).toHaveCount(5)
  await expect(result.locator('.focus-result-metric').first()).toHaveAttribute('data-emphasis', 'primary')
  await expect(result.getByRole('button', { name: '按任意键继续' })).toBeVisible()
  await page.screenshot({
    path: 'test-results/focus-p1/milestone-light.png',
    fullPage: false, animations: 'disabled', timeout: 15000,
  })
})

test('P1 reduced motion disables character feedback animation but preserves response', async ({ page }) => {
  test.setTimeout(70_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedReviewSession(page, reviewWords, 901214)
  await page.goto('/learn')
  await waitForActiveLearnSession(page)
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  const word = page.locator('[data-typing-word="cancel"]')
  await page.keyboard.type('x')
  await expect(word).toHaveAttribute('data-typing-has-wrong', 'true')
  expect(await word.evaluate(node => getComputedStyle(node).animationName)).toBe('none')
  await page.keyboard.press('Escape')
  await expect(word).toHaveAttribute('data-review-hint-level', '3')
})
