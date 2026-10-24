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
      // React handles the click at its root and may stop propagation there.
      document.getElementById('root')!.addEventListener('click', (event) => {
        if ((event.target as Element).closest('a[href$="/mobile/account"]')) {
          sessionStorage.setItem('account-click-handled', String(event.defaultPrevented))
        }
      })
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
    const historyLength = await page.evaluate(() => history.length)
    const timeOrigin = await page.evaluate(() => performance.timeOrigin)
    const link =
      entry === 'avatar' ? page.getByRole('link', { name: '登录或注册', exact: true }) : page.getByRole('link', { name: /账号与云同步/ })
    if (entry === 'avatar') await link.tap()
    else {
      await link.focus()
      await page.keyboard.press('Enter')
    }
    await expect(page.locator('[data-account-overview]')).toBeVisible()
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
    expect(await page.evaluate(() => history.length)).toBe(historyLength)
    await page.getByRole('button', { name: '登录或注册', exact: true }).tap()
    await expect(page.locator('[data-mobile-account]')).toBeVisible()
    expect(context.pages()).toHaveLength(1)
    expect(await page.evaluate(() => history.length)).toBe(historyLength)
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
    await page.evaluate(() => {
      ;(window as any).__diagnosticTransactions = []
      const transaction = IDBDatabase.prototype.transaction
      IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
        ;(window as any).__diagnosticTransactions.push({ name: this.name, mode: args[1] })
        return transaction.apply(this, args)
      }
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            ;(window as any).__copiedWriterDiagnostic = text
          },
        },
      })
    })
    await page.getByRole('button', { name: '复制诊断信息' }).tap()
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__copiedWriterDiagnostic))).toBe(true)
    const diagnostics = await page.evaluate(() => ({
      result: JSON.parse((window as any).__copiedWriterDiagnostic),
      transactions: (window as any).__diagnosticTransactions,
    }))
    expect(diagnostics.result.samples).toHaveLength(2)
    for (const sample of diagnostics.result.samples) {
      expect(sample.native.supported).toBe(mode === 'native')
      if (mode === 'native') expect(sample.native.held).toBe(1)
      expect(sample.lease).toMatchObject({ state: 'present', kind: mode, sameTabOwner: false })
      expect(sample.lease.remainingMs).toBeGreaterThan(0)
      expect(sample.lease.owner).toBeUndefined()
      expect(sample.lease.instance).toBeUndefined()
    }
    const expiryTimes = diagnostics.result.samples.map((sample: any) => Date.parse(sample.observedAt) + sample.lease.remainingMs)
    expect(expiryTimes[1]).toBeGreaterThan(expiryTimes[0])
    expect(diagnostics.transactions).toHaveLength(2)
    expect(diagnostics.transactions.every((tx: any) => tx.name === 'QwertyPlusWriterLeaseV1' && tx.mode === 'readonly')).toBe(true)
    if (mode === 'native') {
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async () => {
              throw new Error('clipboard denied')
            },
          },
        }),
      )
      await page.getByRole('button', { name: '复制诊断信息' }).tap()
      const output = page.getByRole('textbox', { name: '占用诊断信息' })
      await expect(output).toBeVisible()
      expect(JSON.parse(await output.inputValue()).samples).toHaveLength(2)
      await expect(output).toHaveAttribute('readonly', '')
    }

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

test('read-only diagnostics do not create a missing lease database', async ({ page }) => {
  await page.goto('/tests/e2e/backup-harness.html')
  await page.addScriptTag({
    type: 'module',
    content:
      "import { inspectWorkspaceWriter } from '/src/sync/workspace-lock-diagnostics.ts'; window.__inspectWriter = inspectWorkspaceWriter",
  })
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__inspectWriter))).toBe(true)
  const result = await page.evaluate(async () => {
    const before = (await indexedDB.databases()).some((db) => db.name === 'QwertyPlusWriterLeaseV1')
    const info = await (window as any).__inspectWriter()
    const after = (await indexedDB.databases()).some((db) => db.name === 'QwertyPlusWriterLeaseV1')
    return { before, after, info }
  })
  expect(result.before).toBe(false)
  expect(result.after).toBe(false)
  expect(result.info.lease).toEqual({ state: 'missing' })
})
