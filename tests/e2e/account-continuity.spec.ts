import { expect, test } from '@playwright/test'

test('account inspection and responsive layout keep the document, writer lease and learning history', async ({ page }) => {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness))).toBe(true)
  const before = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace({ kind: 'anonymous' })
    return { rows: await h.db.wordRecords.toArray(), registry: await h.workspaceRegistryPort.read() }
  })
  await page.goto('/learn')
  await expect(page.locator('[data-account-entry]')).toBeVisible({ timeout: 30_000 })
  const origin = await page.evaluate(() => performance.timeOrigin)
  await page.locator('[data-account-entry]').click()
  await expect(page.locator('[data-account-overview]')).toBeVisible()
  await page.getByRole('button', { name: '关闭账号窗口' }).click()
  await expect(page.locator('[data-account-overview]')).toHaveCount(0)
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
  await page.setViewportSize({ width: 500, height: 800 })
  await expect(page).toHaveURL(/\/mobile$/)
  await page.getByRole('link', { name: /账号与云同步/ }).click()
  await expect(page.locator('[data-account-overview]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-account-overview]')).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page).toHaveURL(/\/learn$/)
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
  await page.goto('/tests/e2e/backup-harness.html')
  const after = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return { rows: await h.db.wordRecords.toArray(), registry: await h.workspaceRegistryPort.read() }
  })
  expect(after.rows).toEqual(before.rows)
  expect(after.registry.active).toEqual(before.registry.active)
  expect(after.registry.generation).toBe(before.registry.generation)
  expect(after.registry.pending).toBeNull()
})
