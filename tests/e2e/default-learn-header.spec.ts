import { expect, test } from '@playwright/test'

test('homepage defaults to Learn; explicit Typing and Learn links survive reload and back', async ({ page }) => {
  test.setTimeout(70_000)
  await page.goto('/')
  // S1 workspace hydration can hold the initial root route briefly;
  // test the resolved route rather than a fixed 5-second cold-start budget.
  await expect(page).toHaveURL(/\/learn$/, { timeout: 25_000 })
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

test('brand is separated from the right-aligned toolbar and active mode remains clear in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page).toHaveURL(/\/learn$/, { timeout: 25_000 })
  const brand = page.locator('header button[aria-label="打开赞赏页面"]')
  const modes = page.locator('header [data-current-mode]')
  // The / -> /learn cold-start transition can temporarily remount the Header.
  // Accepted focus-UI design: brand stays left, nav is auto-width and right-aligned.
  await expect(brand).toBeVisible({ timeout: 20_000 })
  await expect(modes).toHaveAttribute('data-current-mode', 'learn', { timeout: 20_000 })
  const navigation = page.locator('header nav.focus-header-nav')
  await expect(navigation).toBeVisible()
  await expect.poll(async () => {
    const logo = await brand.boundingBox()
    const switcher = await modes.boundingBox()
    const toolbar = await navigation.boundingBox()
    const header = await page.locator('header').boundingBox()
    return !!logo && !!switcher && !!toolbar && !!header &&
      toolbar.x - (logo.x + logo.width) >= 48 &&
      switcher.x >= toolbar.x &&
      toolbar.x + toolbar.width >= header.x + header.width * 0.65
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
