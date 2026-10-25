import { expect, test } from '@playwright/test'

for (const typed of [true, false]) test(typed
  ? 'pre-business body rejection retries once with identical content and unchanged local owner'
  : 'unknown server 500 is not replayed and preserves local learning', async ({ page }) => {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
  const before = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    return { rows: await h.db.wordRecords.toArray(), active: (await h.workspaceRegistryPort.read()).active }
  })
  const bodies: Array<string | null> = []
  await page.route('**/api/auth/login', async route => {
    bodies.push(route.request().postData())
    if (typed && bodies.length === 1) return route.fulfill({ status: 503,
      json: { error: 'request_body_unavailable', details: { stage: 'request-body', safeToRetry: true } } })
    return route.fulfill({ status: typed ? 401 : 500,
      json: { error: typed ? 'incorrect_password' : 'internal_error' } })
  })
  await page.goto('/?s1-account=manage')
  await page.getByLabel('用户名', { exact: true }).fill('body-retry-fixture')
  await page.getByLabel('账户密码', { exact: true }).fill('synthetic-password')
  await page.getByLabel('账户密码', { exact: true }).press('Enter')
  await expect(page.getByRole('status')).toContainText(typed ? '密码不正确' : '暂时无法完成认证')
  expect(bodies).toHaveLength(typed ? 2 : 1)
  if (typed) expect(bodies[1]).toBe(bodies[0])
  expect(await page.evaluate(() => localStorage.getItem('qwerty.cloudAuth.v1'))).toBeNull()
  await page.goto('/tests/e2e/backup-harness.html')
  const after = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return { rows: await h.db.wordRecords.toArray(), active: (await h.workspaceRegistryPort.read()).active }
  })
  expect(after).toEqual(before)
})
