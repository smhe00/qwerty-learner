import { expect, test } from '@playwright/test'

test('direct analysis deep links remain standalone and reloadable without a fake background session', async ({ page }) => {
  await page.goto('/analysis?from=learn')
  await expect(page.locator('[data-fsrs-shadow-analysis]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-navigation-dialog]')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('[data-fsrs-shadow-analysis]')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)
})

test('Learn navigation stays mounted under dialogs, closes by button and Escape', async ({ page }) => {
  test.setTimeout(60_000)
  page.on('pageerror', error => console.log('Learn navigation pageerror:', error.message))
  await page.goto('/learn')
  console.log('Learn navigation URL:', page.url())
  // Learn initializes its planned session asynchronously; set the keepalive
  // marker only after the intended session-view Header is mounted.
  await expect(page.getByText('按任意键开始')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Learn', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })
  const header = page.locator('header').filter({ has: page.locator('nav') }).first()
  await header.evaluate((node) => { node.dataset.navigationKeepAlive = 'yes' })
  await page.getByRole('button', { name: '查看数据统计' }).click()
  await expect(page).toHaveURL(/\/analysis\?from=learn$/)
  const modal = page.locator('[data-navigation-dialog="analysis"]')
  await expect(modal).toBeVisible()
  await expect(header).toHaveAttribute('data-navigation-keep-alive', 'yes')
  const rect = await modal.boundingBox()
  expect(rect).toBeTruthy()
  expect(rect!.width).toBeLessThan(1440)
  expect(rect!.height).toBeLessThan(900)
  await modal.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(header).toHaveAttribute('data-navigation-keep-alive', 'yes')

  await page.locator('header nav a[href="/gallery?mode=learn"]').click()
  await expect(page.locator('[data-navigation-dialog="gallery"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/learn$/)
  await expect(page.locator('[data-navigation-dialog]')).toHaveCount(0)
})

test('Typing switches open gallery, error book, and achievements in size-limited dialogs', async ({ page }) => {
  await page.goto('/typing')
  await expect(page.getByRole('button', { name: 'Typing', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const header = page.locator('header').filter({ has: page.locator('nav') }).first()
  await header.evaluate((node) => { node.dataset.navigationKeepAlive = 'yes' })

  await page.locator('header nav a[href="/gallery"]').click()
  await expect(page.locator('[data-navigation-dialog="gallery"]')).toBeVisible()
  await expect(header).toHaveAttribute('data-navigation-keep-alive', 'yes')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/typing$/)

  await page.getByRole('button', { name: '查看错题本' }).click()
  await expect(page.locator('[data-navigation-dialog="error-book"]')).toBeVisible()
  await expect(header).toHaveAttribute('data-navigation-keep-alive', 'yes')
  await page.locator('[data-navigation-dialog="error-book"]').getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/typing$/)

  await page.getByRole('button', { name: '查看成就' }).click()
  await expect(page.locator('[data-navigation-dialog="achievements"]')).toBeVisible()
  await expect(header).toHaveAttribute('data-navigation-keep-alive', 'yes')
  await page.locator('[data-navigation-dialog="achievements"]').getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/typing$/)
})


test('dictionary detail opens above the gallery dialog and closes without leaving the gallery', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/typing')
  await page.locator('header nav a[href="/gallery"]').click()
  const gallery = page.locator('[data-navigation-dialog="gallery"]')
  await expect(gallery).toBeVisible()
  const card = gallery.locator('[role="button"][tabindex="0"]').first()
  await expect(card).toBeVisible({ timeout: 20_000 })
  await card.click()
  await expect(page.locator('[role="dialog"][data-state="open"]')).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(gallery).toBeVisible()
  await gallery.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/typing$/)
})
