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


test('study toolbar uses one row or two rows, splitting only after pronunciation; narrow widths use mobile layout', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/typing')
  await expect(page.locator('[data-toolbar-row="primary"]')).toBeVisible({ timeout: 20_000 })

  for (const width of [1440, 1280, 1100, 1024, 900, 768, 701]) {
    await page.setViewportSize({ width, height: 900 })
    const nav = page.locator('header nav.focus-header-nav')
    const primary = nav.locator('[data-toolbar-row="primary"]')
    const icons = nav.locator('[data-toolbar-row="icons"]')
    await expect(primary).toBeVisible()
    await expect(icons).toBeVisible()

    const layout = await nav.evaluate((element) => {
      const primaryRow = element.querySelector<HTMLElement>('[data-toolbar-row="primary"]')
      const iconRow = element.querySelector<HTMLElement>('[data-toolbar-row="icons"]')
      if (!primaryRow || !iconRow) throw new Error('Expected the two explicit toolbar rows')
      const navStyle = getComputedStyle(element)
      const contentWidth = element.clientWidth -
        Number.parseFloat(navStyle.paddingLeft) - Number.parseFloat(navStyle.paddingRight)
      const primaryRect = primaryRow.getBoundingClientRect()
      const iconRect = iconRow.getBoundingClientRect()
      const primaryChildren = Array.from(primaryRow.children).map(child => child.getBoundingClientRect())
      const iconStrip = iconRow.querySelector<HTMLElement>('.focus-toolbar-icons')
      const pronunciation = primaryRow.querySelector(
        'button[aria-label^="发音口音"], button[aria-label^="发音及音标切换"]',
      )
      if (!iconStrip || !pronunciation) throw new Error('Pronunciation and icon strip must be present')
      const iconChildren = Array.from(iconStrip.children).map(child => child.getBoundingClientRect())
      return {
        contentWidth,
        primaryWidth: primaryRect.width,
        iconsWidth: iconRect.width,
        primaryTop: primaryRect.top,
        primaryBottom: primaryRect.bottom,
        primaryCenterY: primaryRect.top + primaryRect.height / 2,
        iconsTop: iconRect.top,
        iconsCenterY: iconRect.top + iconRect.height / 2,
        primaryWrap: getComputedStyle(primaryRow).flexWrap,
        iconsWrap: getComputedStyle(iconRow).flexWrap,
        iconStripWrap: getComputedStyle(iconStrip).flexWrap,
        iconStripOverflow: iconChildren.some(rect =>
          rect.left < iconStrip.getBoundingClientRect().left - 1 ||
          rect.right > iconStrip.getBoundingClientRect().right + 1),
        primaryChildrenOverflow: primaryChildren.some(rect =>
          rect.left < primaryRect.left - 1 || rect.right > primaryRect.right + 1 ||
          rect.top < primaryRect.top - 1 || rect.bottom > primaryRect.bottom + 1),
        iconsFollowPrimary: primaryRow.nextElementSibling === iconRow,
        pronunciationInPrimary: primaryRow.contains(pronunciation),
      }
    })
    expect(layout.primaryWidth, 'primary controls must fit at ' + width + 'px').toBeLessThanOrEqual(layout.contentWidth + 1)
    expect(layout.iconsWidth, 'icon row must fit at ' + width + 'px').toBeLessThanOrEqual(layout.contentWidth + 1)
    expect(layout.primaryWrap).toBe('nowrap')
    expect(layout.iconsWrap).toBe('nowrap')
    expect(layout.iconStripWrap).toBe('nowrap')
    expect(layout.iconStripOverflow).toBe(false)
    expect(layout.primaryChildrenOverflow).toBe(false)
    expect(layout.iconsFollowPrimary).toBe(true)
    expect(layout.pronunciationInPrimary).toBe(true)
    if (Math.abs(layout.primaryCenterY - layout.iconsCenterY) >= 8) {
      expect(layout.iconsTop).toBeGreaterThanOrEqual(layout.primaryBottom - 1)
    }
  }

  await page.setViewportSize({ width: 700, height: 900 })
  await expect(page).toHaveURL(/\/mobile$/, { timeout: 10_000 })
  await expect(page.locator('header nav.focus-header-nav')).toHaveCount(0)
})
