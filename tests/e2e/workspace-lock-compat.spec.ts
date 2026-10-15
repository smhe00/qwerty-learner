import { expect, test, type Page } from '@playwright/test'

async function withoutWebLocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  })
}

async function harness(page: Page): Promise<void> {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.acquireWorkspaceWriterLease),
  )).toBe(true)
}

test('P0: Web-Locks-less new browser survives refresh without the safety wall', async ({ page }) => {
  await withoutWebLocks(page)
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  for (let i = 0; i < 2; i++) {
    await page.reload()
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  }
  await expect(page.getByText('学习数据安全检查未通过')).toHaveCount(0)
})

test('P0: new browser without Web Locks can initialize its empty S1 account workspace', async ({ page }) => {
  await withoutWebLocks(page)
  await page.goto('/?s1-account=manage')
  await expect(page.getByRole('heading', { name: '安全账户管理（S1）' }))
    .toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('学习数据安全检查未通过')).toHaveCount(0)
})

test('P0: two Web-Locks-less tabs cannot both acquire a writer lease', async ({ page, context }) => {
  await withoutWebLocks(page)
  await harness(page)
  const saved = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    ;(window as any).__fallbackLease = await h.acquireWorkspaceWriterLease()
    return h.db.wordRecords.count()
  })
  expect(saved).toBe(1)

  const second = await context.newPage()
  await withoutWebLocks(second)
  await harness(second)
  const rejected = await second.evaluate(async () => {
    try {
      const lease = await (window as any).__backupHarness.acquireWorkspaceWriterLease()
      lease.release()
      return false
    } catch (error) {
      return String(error).includes('Another tab owns')
    }
  })
  expect(rejected).toBe(true)
  expect(await second.evaluate(() =>
    (window as any).__backupHarness.db.wordRecords.count())).toBe(1)

  await page.evaluate(() => (window as any).__fallbackLease.release())
  await expect.poll(() => second.evaluate(async () => {
    try {
      const lease = await (window as any).__backupHarness.acquireWorkspaceWriterLease()
      lease.release()
      return true
    } catch { return false }
  })).toBe(true)
  await second.close()
})

test('P0: copied tab identity cannot steal a live fallback lease', async ({ page, context }) => {
  await withoutWebLocks(page)
  await harness(page)
  const owner = await page.evaluate(async () => {
    ;(window as any).__fallbackLease =
      await (window as any).__backupHarness.acquireWorkspaceWriterLease()
    return sessionStorage.getItem('qwerty.s1.writer-tab-token')
  })
  expect(owner).toMatch(/^[0-9a-f]{32}$/)
  const clone = await context.newPage()
  await clone.addInitScript(ownerToken => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    sessionStorage.setItem('qwerty.s1.writer-tab-token', ownerToken!)
  }, owner)
  await harness(clone)
  const rejected = await clone.evaluate(async () => {
    try {
      const lease = await (window as any).__backupHarness.acquireWorkspaceWriterLease()
      lease.release()
      return false
    } catch (error) {
      return String(error).includes('Another tab owns')
    }
  })
  expect(rejected).toBe(true)
  await page.evaluate(() => (window as any).__fallbackLease.release())
  await clone.close()
})

test('P0: native Web Locks and fallback tabs share the same writer election', async ({ page, context }) => {
  await harness(page)
  await page.evaluate(async () => {
    ;(window as any).__nativeLease =
      await (window as any).__backupHarness.acquireWorkspaceWriterLease()
  })
  const second = await context.newPage()
  await withoutWebLocks(second)
  await harness(second)
  const rejected = await second.evaluate(async () => {
    try {
      const lease = await (window as any).__backupHarness.acquireWorkspaceWriterLease()
      lease.release()
      return false
    } catch (error) {
      return String(error).includes('Another tab owns')
    }
  })
  expect(rejected).toBe(true)
  await page.evaluate(() => (window as any).__nativeLease.release())
  await second.close()
})

test('P0: missing all persistent transactional storage still fails closed', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined })
  })
  await page.goto('/')
  await expect(page.getByText('学习数据安全检查未通过')).toBeVisible()
  await expect(page.getByText(/IndexedDB unavailable: S1 writer ownership refused/)).toBeVisible()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
})
