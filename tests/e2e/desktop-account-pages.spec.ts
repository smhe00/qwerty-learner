import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

test('Pages desktop shares account preview, disables cloud and returns to the PC basename', async ({ page }) => {
  let calls = 0
  page.on('request', (request) => {
    if (request.url().includes('/api/')) calls++
  })
  await page.goto('/qwerty-learner/?s1-account=manage')
  await expect(page.locator('[data-desktop-account]')).toBeVisible()
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' })).toBeVisible()
  await expect(page.getByRole('note')).toContainText('当前为开发预览')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled()
  await page.getByRole('tab', { name: '注册', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '注册须知' })).toContainText('连续超过 6 个月')
  await expect(page.getByRole('button', { name: '注册并登录' })).toBeDisabled()
  await expect(page.getByLabel('用户名', { exact: true })).toBeDisabled()
  expect(calls).toBe(0)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/qwerty-learner\/$/)
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
})
