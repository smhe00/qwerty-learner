import { expect, test } from '@playwright/test'

const snapshots = 'test-results/focus-ui'

test('Focus tokens and primary learning modes stay legible in light and dark', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  // Warm up the S1 workspace once before navigating into Learn.
  await page.goto('/typing')
  await expect(page.locator('header [data-current-mode]')).toHaveAttribute('data-current-mode', 'typing', { timeout: 20_000 })
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)
  const modes = page.locator('header [data-current-mode]')
  await expect(modes).toHaveAttribute('data-current-mode', 'learn', { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Learn', exact: true })).toHaveAttribute('aria-pressed', 'true')

  const computed = async () => page.evaluate(() => ({
    canvas: getComputedStyle(document.documentElement).getPropertyValue('--focus-canvas').trim(),
    accent: getComputedStyle(document.documentElement).getPropertyValue('--focus-accent').trim(),
    body: getComputedStyle(document.body).backgroundColor,
    mode: getComputedStyle(document.querySelector('[aria-pressed="true"]')!).backgroundColor,
  }))
  const light = await computed()
  expect(light.canvas).toBe('#f7f8fa')
  expect(light.accent).toBe('#465fb0')
  await page.screenshot({ path: `${snapshots}/learn-light-1440.png`, fullPage: false, timeout: 15_000, animations: 'disabled' })

  await page.getByRole('button', { name: '开关深色模式' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  // Background has a deliberate 180ms theme transition. Wait for its final
  // color rather than interpreting an intermediate frame as a design defect.
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(16, 23, 34)')
  await expect(page.getByRole('button', { name: 'Learn', exact: true })).toHaveCSS('background-color', 'rgb(159, 181, 243)')
  const dark = await computed()
  expect(dark.canvas).toBe('#101722')
  expect(dark.accent).toBe('#9fb5f3')
  expect(dark.body).not.toBe(light.body)
  expect(dark.mode).not.toBe(light.mode)
  await page.screenshot({ path: `${snapshots}/learn-dark-1440.png`, fullPage: false, timeout: 15_000, animations: 'disabled' })
})

test('Typing and Learn statistics use Focus surfaces without muting the entire panel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/typing')
  await expect(page.locator('.focus-stats-strip')).toBeVisible({ timeout: 20_000 })
  const typingStrip = page.locator('.focus-stats-strip')
  await expect(typingStrip.locator('.focus-stat-cell')).toHaveCount(5)
  const style = await typingStrip.evaluate((node) => ({
    opacity: getComputedStyle(node).opacity,
    border: getComputedStyle(node).borderTopColor,
  }))
  expect(style.opacity).toBe('1')
  expect(style.border).not.toBe('rgba(0, 0, 0, 0)')
  await page.screenshot({ path: `${snapshots}/typing-light-1280.png`, fullPage: false, timeout: 15_000, animations: 'disabled' })

  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(page.locator('[data-current-mode]')).toHaveAttribute('data-current-mode', 'learn')
  await page.screenshot({ path: `${snapshots}/learn-light-1280.png`, fullPage: false, timeout: 15_000, animations: 'disabled' })
})

test('At smaller desktop width the study header and mode stay inside viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/typing')
  const mode = page.locator('[data-current-mode]')
  await expect(mode).toHaveAttribute('data-current-mode', 'typing', { timeout: 20_000 })
  await expect.poll(async () => {
    const box = await mode.boundingBox()
    return box && box.x >= 0 && box.x + box.width <= 1024
  }).toBe(true)
  await page.screenshot({ path: `${snapshots}/typing-light-1024.png`, fullPage: false, timeout: 15_000, animations: 'disabled' })
})

test('Focus-style navigation dialog remains dismissible and retains study mode', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/typing')
  await page.locator('header nav a[href="/gallery"]').click()
  const dialog = page.locator('[data-navigation-dialog="gallery"]')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveClass(/focus-overlay-panel/)
  await dialog.screenshot({ path: `${snapshots}/gallery-light.png`, timeout: 15_000, animations: 'disabled' })
  await dialog.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/typing$/)
  await expect(page.getByRole('button', { name: 'Typing', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
