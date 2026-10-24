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


for (const mode of ['typing', 'learn'] as const) {
  test(mode + ': wrapped toolbar centers both rows with pronunciation leading row two', async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1920, height: 900 })
    await page.goto('/' + mode)
    await expect(page.locator('[data-toolbar-row="primary"]')).toBeVisible({ timeout: 20_000 })
    let sawSingleRow = false
    let sawTwoRows = false

    for (const width of [1920, 1600, 1594, 1536, 1440, 1366, 1281, 1280, 1279, 1240, 1200, 1160, 1120, 1100, 1024, 900, 768, 701, 1024, 1280, 1594, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      const nav = page.locator('header nav.focus-header-nav')
      await expect(nav.locator('[data-toolbar-row="primary"]')).toBeVisible()
      await expect(nav.locator('[data-toolbar-row="icons"]')).toBeVisible()
      const layout = await nav.evaluate((element) => {
        const primary = element.querySelector<HTMLElement>('[data-toolbar-row="primary"]')!
        const secondary = element.querySelector<HTMLElement>('[data-toolbar-row="icons"]')!
        const strip = secondary.querySelector<HTMLElement>('.focus-toolbar-icons')!
        const pronunciation = secondary.querySelector<HTMLElement>(
          'button[aria-label^="发音口音"], button[aria-label^="发音及音标切换"]',
        )!
        if (!strip || !pronunciation) throw Error('Pronunciation must lead the secondary group')
        const style = getComputedStyle(element)
        const nav = element.getBoundingClientRect()
        const leftInset = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
        const rightInset = parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight)
        const contentWidth = nav.width - leftInset - rightInset
        const header = element.parentElement!
        const headerGap = parseFloat(getComputedStyle(header).columnGap)
        const siblings = Array.from(header.children).filter(child => child !== element)
        const siblingBoxes = siblings.map(child => child.getBoundingClientRect())
        const available = header.clientWidth - siblingBoxes.reduce((sum, box) => sum + box.width, 0) - siblings.length * headerGap
        const p = primary.getBoundingClientRect()
        const s = secondary.getBoundingClientRect()
        const a = pronunciation.getBoundingClientRect()
        const i = strip.getBoundingClientRect()
        return {
          contentWidth,
          canStayBesideBrand: available >= Math.max(p.width, s.width) + leftInset + rightInset,
          sharesBrandRow: nav.top < siblingBoxes[0].bottom && nav.bottom > siblingBoxes[0].top,
          headerOverlaps: siblingBoxes.some(box => nav.left < box.right - 1 && nav.right > box.left + 1 &&
            nav.top < box.bottom - 1 && nav.bottom > box.top + 1),
          navCenter: nav.left + leftInset + contentWidth / 2,
          primaryWidth: p.width, secondaryWidth: s.width,
          primaryCenterX: p.left + p.width / 2, secondaryCenterX: s.left + s.width / 2,
          primaryCenterY: p.top + p.height / 2, secondaryCenterY: s.top + s.height / 2,
          primaryBottom: p.bottom, secondaryTop: s.top,
          primaryWrap: getComputedStyle(primary).flexWrap,
          secondaryWrap: getComputedStyle(secondary).flexWrap,
          stripWrap: getComputedStyle(strip).flexWrap,
          pronunciationTop: a.top, pronunciationRight: a.right, stripLeft: i.left,
          pronunciationFirst: secondary.firstElementChild?.contains(pronunciation),
          groupsAdjacent: primary.nextElementSibling === secondary,
          childrenOverflow: [primary, secondary].some(group => {
            const box = group.getBoundingClientRect()
            return Array.from(group.children).some(child => {
              const rect = child.getBoundingClientRect()
              return rect.left < box.left - 1 || rect.right > box.right + 1 ||
                rect.top < box.top - 1 || rect.bottom > box.bottom + 1
            })
          }),
          stripOverflow: Array.from(strip.children).some(child => {
            const rect = child.getBoundingClientRect()
            return rect.left < i.left - 1 || rect.right > i.right + 1
          }),
          viewportOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        }
      })
      if (Math.abs(layout.primaryCenterY - layout.secondaryCenterY) >= 8) {
        expect(Math.abs(layout.contentWidth - Math.max(layout.primaryWidth, layout.secondaryWidth))).toBeLessThanOrEqual(1)
      }
      if (width === 1024) await nav.screenshot({ path: snapshots + '/' + mode + '-compact-toolbar.png' })
      expect(layout.primaryWidth).toBeLessThanOrEqual(layout.contentWidth + 1)
      expect(layout.secondaryWidth).toBeLessThanOrEqual(layout.contentWidth + 1)
      expect(layout.primaryWrap).toBe('nowrap')
      expect(layout.secondaryWrap).toBe('nowrap')
      expect(layout.stripWrap).toBe('nowrap')
      expect(layout.childrenOverflow).toBe(false)
      expect(layout.stripOverflow).toBe(false)
      expect(layout.viewportOverflow).toBe(false)
      expect(layout.headerOverlaps).toBe(false)
      expect(layout.sharesBrandRow).toBe(layout.canStayBesideBrand)
      if (width === 1594 || width === 1279) {
        await page.locator('header').screenshot({ path: snapshots + '/' + mode + '-header-' + width + '.png' })
      }
      expect(layout.groupsAdjacent).toBe(true)
      expect(layout.pronunciationFirst).toBe(true)
      expect(layout.pronunciationRight).toBeLessThanOrEqual(layout.stripLeft)
      if (Math.abs(layout.primaryCenterY - layout.secondaryCenterY) >= 8) {
        sawTwoRows = true
        expect(layout.secondaryTop).toBeGreaterThanOrEqual(layout.primaryBottom - 1)
        expect(layout.pronunciationTop).toBeGreaterThanOrEqual(layout.primaryBottom - 1)
        expect(Math.abs(layout.primaryCenterX - layout.navCenter)).toBeLessThanOrEqual(1)
        expect(Math.abs(layout.secondaryCenterX - layout.navCenter)).toBeLessThanOrEqual(1)
      } else {
        sawSingleRow = true
      }
    }
    expect(sawSingleRow).toBe(true)
    expect(sawTwoRows).toBe(true)
    await page.setViewportSize({ width: 700, height: 900 })
    await expect(page).toHaveURL(/\/mobile$/, { timeout: 10_000 })
    await expect(page.locator('header nav.focus-header-nav')).toHaveCount(0)
  })
}
