import { expect, test } from '@playwright/test'

test('direct analysis deep link and refresh keep a usable dismissible modal', async ({ page }) => {
  test.setTimeout(75_000)
  page.on('pageerror', error => console.log('direct analysis pageerror:', error.message))
  await page.goto('/analysis?from=learn')
  console.log('direct analysis URL:', page.url())
  console.log('direct analysis body:', (await page.locator('body').innerText()).slice(0, 700))
  await expect(page.locator('[data-navigation-dialog="analysis"]')).toBeVisible({ timeout: 20_000 }).catch(async (error) => {
    console.log('direct analysis after wait:', (await page.locator('body').innerText()).slice(0, 700))
    throw error
  })
  await page.reload()
  await expect(page.locator('[data-navigation-dialog="analysis"]')).toBeVisible({ timeout: 20_000 })
  await page.locator('[data-navigation-dialog="analysis"]').getByRole('button', { name: '返回', exact: true }).click()
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
  const header = page.locator('header')
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
  const header = page.locator('header')
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

