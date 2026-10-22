import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

async function fallback(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  })
}
async function hold(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    ;(window as any).__ownerLease = await h.acquireWorkspaceWriterLease()
  })
}
async function records(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.db))).toBe(true)
  expect(await page.evaluate(() => (window as any).__backupHarness.db.wordRecords.count())).toBe(1)
}

for (const entry of ['avatar', 'menu']) {
  test('normal ' + entry + ' activation stays in one tab under a mobile new-link policy', async ({ page, context }) => {
    await page.goto('/mobile')
    await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => {
      const base = document.createElement('base')
      base.target = '_blank'
      document.head.append(base)
      // Model an embedder that opens ordinary link activations in another tab.
      document.addEventListener('click', (event) => {
        const link = (event.target as Element).closest('a[href$="/mobile/account"]') as HTMLAnchorElement | null
        if (!link) return
        sessionStorage.setItem('account-click-handled', String(event.defaultPrevented))
        if (!event.defaultPrevented) {
          event.preventDefault()
          window.open(link.href, '_blank')
        }
      })
    })
    const link =
      entry === 'avatar' ? page.getByRole('link', { name: '登录或注册', exact: true }) : page.getByRole('link', { name: /账号与云同步/ })
    if (entry === 'avatar') await link.tap()
    else {
      await link.focus()
      await page.keyboard.press('Enter')
    }
    await expect(page.locator('[data-mobile-account]')).toBeVisible()
    expect(context.pages()).toHaveLength(1)
    expect(await page.evaluate(() => sessionStorage.getItem('account-click-handled'))).toBe('true')
  })
}

for (const mode of ['native', 'fallback']) {
  test(mode + ' delayed writer release automatically admits mobile account without stealing', async ({ page, context }) => {
    const owner = await context.newPage()
    if (mode === 'fallback') {
      await fallback(owner)
      await fallback(page)
    }
    await hold(owner)
    await page.addInitScript(() => {
      ;(window as any).__leaseAttempts = 0
      const transaction = IDBDatabase.prototype.transaction
      IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
        if (this.name === 'QwertyPlusWriterLeaseV1' && args[1] === 'readwrite') (window as any).__leaseAttempts++
        return transaction.apply(this, args)
      }
      if (navigator.locks) {
        const request = navigator.locks.request.bind(navigator.locks)
        navigator.locks.request = ((name: string, options: any, callback: any) =>
          request(name, options, (lock: any) => {
            if (name === 'qwerty-plus.s1.working-db-writer' && !lock) (window as any).__leaseAttempts++
            return callback(lock)
          })) as typeof navigator.locks.request
      }
    })
    await page.goto('/mobile/account')
    await expect.poll(() => page.evaluate(() => (window as any).__leaseAttempts)).toBeGreaterThan(0)
    await expect(page.locator('[data-mobile-account]')).toHaveCount(0)
    await expect(page.getByText('学习数据暂时被占用', { exact: true })).toHaveCount(0)
    await owner.evaluate(() => (window as any).__ownerLease.release())
    await expect(page.locator('[data-mobile-account]')).toBeVisible()
    await owner.close()
    await records(page)
  })

  test(mode + ' live writer stays exclusive; in-place retry recovers only after release', async ({ page, context }) => {
    const owner = await context.newPage()
    if (mode === 'fallback') {
      await fallback(owner)
      await fallback(page)
    }
    await hold(owner)
    let apiCalls = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls++
    })
    await page.goto('/mobile/account')
    await expect(page.getByRole('heading', { name: '学习数据暂时被占用' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-mobile-account], [data-mobile-menu]')).toHaveCount(0)
    expect(apiCalls).toBe(0)
    expect(await owner.evaluate(() => (window as any).__backupHarness.db.wordRecords.count())).toBe(1)
    const documentId = await page.evaluate(() => {
      ;(window as any).__documentId = crypto.randomUUID()
      return (window as any).__documentId
    })
    await page.getByRole('button', { name: '在此重试' }).tap()
    await expect(page.getByRole('heading', { name: '正在准备本地学习数据' })).toBeVisible()
    await expect(page.locator('[data-mobile-account]')).toHaveCount(0)
    await owner.evaluate(() => (window as any).__ownerLease.release())
    await expect(page.locator('[data-mobile-account]')).toBeVisible()
    expect(await page.evaluate(() => (window as any).__documentId)).toBe(documentId)
    expect(apiCalls).toBe(0)
    await owner.close()
    await records(page)
  })
}
