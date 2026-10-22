import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
test('Pages exposes phone account preview but keeps all cloud authentication disabled', async ({ page }) => {
  let requests = 0
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests++
  })
  await page.goto('/qwerty-learner/mobile')
  await page.getByRole('link', { name: '登录或注册', exact: true }).tap()
  await expect(page).toHaveURL(/\/qwerty-learner\/mobile\/account$/)
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' })).toBeVisible()
  await expect(page.getByRole('note')).toContainText('当前为开发预览')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled()
  await page.getByRole('tab', { name: '注册', exact: true }).tap()
  await expect(page.getByRole('button', { name: '注册并登录' })).toBeDisabled()
  await expect(page.getByLabel('用户名', { exact: true })).toBeDisabled()
  expect(requests).toBe(0)
  await page.getByRole('button', { name: '返回', exact: true }).tap()
  await expect(page).toHaveURL(/\/qwerty-learner\/mobile$/)
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
})
