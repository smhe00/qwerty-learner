import { expect, test } from '@playwright/test'
import { gotoReviewAppReady } from './review-flow-harness'

test('every small header icon has one 36px style and is skipped by keyboard tab order', async ({ page }) => {
  await gotoReviewAppReady(page, '/typing')
  const toolbar = page.locator('header .focus-toolbar-icons')
  const triggers = toolbar.locator('button[data-toolbar-trigger]')
  await expect(triggers).toHaveCount(10)

  for (const trigger of await triggers.all()) {
    await expect(trigger).toHaveAttribute('tabindex', '-1')
    const size = await trigger.evaluate((button) => {
      const rect = button.getBoundingClientRect()
      const style = getComputedStyle(button)
      return {
        width: rect.width, height: rect.height,
        radius: style.borderRadius,
      }
    })
    expect(size.width).toBe(36)
    expect(size.height).toBe(36)
    expect(size.radius).toBe('10px')
  }
})

test('mouse click toggles dark mode, but Enter/Space or retained icon focus cannot toggle it', async ({ page }) => {
  await gotoReviewAppReady(page, '/typing')
  const darkButton = page.getByRole('button', { name: '开关深色模式' })
  const darkState = () => page.locator('html').evaluate((el) => el.classList.contains('dark'))
  const original = await darkState()

  await darkButton.click()
  await expect.poll(darkState).toBe(!original)
  await expect(darkButton).not.toBeFocused()
  await darkButton.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await expect.poll(darkState).toBe(!original)

  await darkButton.click()
  await expect.poll(darkState).toBe(original)
})

test('popover icons remain mouse clickable while Learn unavailable icons stay disabled', async ({ page }) => {
  await gotoReviewAppReady(page, '/')
  const loop = page.getByRole('button', { name: '选择单词的循环次数' })
  await expect(loop).toBeDisabled()
  const sound = page.getByRole('button', { name: '音效设置' })
  await sound.click()
  await expect(page.getByText('开关按键音', { exact: true })).toBeVisible()
  await expect(sound).not.toBeFocused()
  await sound.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('开关按键音', { exact: true })).toBeVisible()
})
