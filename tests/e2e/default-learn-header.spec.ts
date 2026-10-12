import { expect, test } from '@playwright/test'

test('homepage defaults to Learn; explicit Typing and Learn links survive reload and back', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/learn$/)
  const learn = page.getByRole('button', { name: 'Learn', exact: true })
  const typing = page.getByRole('button', { name: 'Typing', exact: true })
  await expect(learn).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('header [data-current-mode]')).toHaveAttribute('data-current-mode', 'learn')
  await expect(learn).toContainText('当前')
  await expect(typing).not.toContainText('当前')

  await typing.click()
  await expect(page).toHaveURL(/\/typing$/)
  await expect(typing).toHaveAttribute('aria-pressed', 'true')
  await expect(typing).toContainText('当前')
  await page.reload()
  await expect(page).toHaveURL(/\/typing$/)
  await expect(page.getByRole('button', { name: 'Typing', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)
  await page.reload()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(page.getByRole('button', { name: 'Learn', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.goBack()
  await expect(page).toHaveURL(/\/typing$/)
})

test('brand stays adjacent to mode switch and active button is visually unmistakable in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page).toHaveURL(/\/learn$/)
  const brand = page.locator('header button[aria-label="打开赞赏页面"]')
  const modes = page.locator('header [data-current-mode]')
  // The / -> /learn cold-start transition can temporarily remount the
  // Header while S1 hydrates. Sample real layout only after it is stable.
  await expect(brand).toBeVisible({ timeout: 20_000 })
  await expect(modes).toHaveAttribute('data-current-mode', 'learn', { timeout: 20_000 })
  await expect.poll(async () => {
    const logo = await brand.boundingBox()
    const switcher = await modes.boundingBox()
    return !!logo && !!switcher &&
      switcher.x - (logo.x + logo.width) < 50 &&
      switcher.x >= logo.x + logo.width - 2
  }, { timeout: 20_000 }).toBe(true)

  const learn = page.getByRole('button', { name: 'Learn', exact: true })
  const typing = page.getByRole('button', { name: 'Typing', exact: true })
  async function styles() {
    return page.evaluate(() => {
      const group = document.querySelector('[data-current-mode]')!
      const active = group.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')!
      const inactive = group.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!
      return {
        activeBackground: getComputedStyle(active).backgroundColor,
        inactiveBackground: getComputedStyle(inactive).backgroundColor,
        activeColor: getComputedStyle(active).color,
        inactiveColor: getComputedStyle(inactive).color,
      }
    })
  }
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') {
      await page.getByRole('button', { name: '开关深色模式' }).click()
      await expect(page.locator('html')).toHaveClass(/dark/)
    }
    const color = await styles()
    expect(color.activeBackground).not.toBe(color.inactiveBackground)
    expect(color.activeColor).not.toBe(color.inactiveColor)
    await expect(learn).toContainText('当前')
    await expect(typing).not.toContainText('当前')
  }
})

test('explicit Typing deep link clears stale selected mode without discarding stored Learn record', async ({ page }) => {
  await page.goto('/learn')
  await expect(page).toHaveURL(/\/learn$/)
  await page.evaluate(() => {
    localStorage.setItem('reviewModeInfo', JSON.stringify({
      isReviewMode: true,
      reviewRecord: { id: 8933, dict: 'cet4', createTime: 123, index: 0, words: [], isFinished: false },
    }))
  })
  await page.goto('/typing')
  await expect(page).toHaveURL(/\/typing$/)
  await expect(page.getByRole('button', { name: 'Typing', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('reviewModeInfo') || '{}'))
  expect(persisted.isReviewMode).toBe(false)
  expect(persisted.reviewRecord.id).toBe(8933)
})
