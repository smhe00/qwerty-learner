import { expect, test } from '@playwright/test'

test('slow failed maintenance leaves login and learning responsive and normal users have no administrator controls', async ({ page }) => {
  let maintenance: (() => Promise<void>) | undefined
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/maintenance/idle') {
      maintenance = () => route.fulfill({ status: 401, json: { error: 'session_revoked' } })
      return
    }
    await route.fulfill({ json: path.endsWith('/access') ? { administrator: false } : { enabled: true } })
  })
  await page.addInitScript(() => {
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({ token: 'normal' }))
    window.addEventListener('qwerty:cloud-session-revoked', () => { document.documentElement.dataset.testRevoked = 'yes' })
  })
  await page.goto('/tests/e2e/idle-cleanup-harness.html')
  await expect(page.getByRole('heading', { name: '登录已完成' })).toBeVisible()
  await expect(page.getByText(/连续180天/)).toBeVisible()
  await expect(page.getByText(/宽限期/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '预览清理名单' })).toHaveCount(0)
  await expect.poll(() => Boolean(maintenance)).toBe(true)
  await page.getByRole('button', { name: '继续学习 0', exact: true }).click()
  await expect(page.getByRole('button', { name: '继续学习 1', exact: true })).toBeVisible()
  await maintenance!()
  await page.getByRole('button', { name: '继续学习 1', exact: true }).click()
  await expect(page.getByRole('button', { name: '继续学习 2', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.testRevoked)).toBeUndefined()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}').token)).toBe('normal')
})

test('administrator previews before confirmed cleanup and local learning records stay intact', async ({ page }) => {
  let writes = 0
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/access')) return route.fulfill({ json: { administrator: true } })
    if (path.endsWith('/storage')) return route.fulfill({ json: { objects: 10, accounts: 2, reportedBytes: 0, sizeComplete: false } })
    if (path.endsWith('/maintenance/idle')) return route.fulfill({ json: { status: 'already_ran' } })
    if (path.endsWith('/account-policy')) return route.fulfill({ json: { enabled: true } })
    if (route.request().method() === 'POST') writes++
    return route.fulfill({ json: { dryRun: writes === 0, executionEnabled: true, nextCursor: null,
      results: [{ userId: 'example', username: 'expired-learner', action: writes ? 'draining' : 'candidate' }] } })
  })
  await page.goto('/tests/e2e/idle-cleanup-harness.html?token=admin')
  await page.evaluate(() => localStorage.setItem('test-learning-sentinel', 'unchanged'))
  await page.getByRole('button', { name: '预览清理名单' }).click()
  await expect(page.getByText(/expired-learner/)).toBeVisible()
  expect(writes).toBe(0)
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '对本页运行清理' }).click()
  expect(writes).toBe(0)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '对本页运行清理' }).click()
  await expect(page.getByText(/等待已有请求结束/)).toBeVisible()
  expect(writes).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('test-learning-sentinel'))).toBe('unchanged')
})
