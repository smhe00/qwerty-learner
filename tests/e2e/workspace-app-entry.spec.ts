import { expect, test, type Page } from '@playwright/test'

async function harness(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
}

test('real application loads unchanged legacy records after guarded boot', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  const records = await page.evaluate(() => (window as any).__backupHarness.db.wordRecords.count())
  expect(records).toBe(1)
})

test('second actual app tab is held outside React until writer tab closes', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByText('另一个标签页正在使用学习数据')).toBeVisible()
  await expect(second.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
  await page.close()
  await second.getByRole('button', { name: '重试' }).click()
  await expect(second.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await second.close()
})

test('initialized anonymous workspace permits actual app mount without implicit migration', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  const result = await page.evaluate(() => (window as any).__backupHarness.workspaceRegistryPort.read())
  expect(result.generation).toBe(1)
  expect(result.active).toEqual({ kind: 'anonymous' })
})

test('real app blocks S1-auth mismatch without executing the application', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'simulated-valid-token', expiresAt: Math.floor(Date.now()/1000) + 3600,
      user: { userId: 'other-account', username: 'other' },
    }))
  })
  await page.goto('/')
  await expect(page.getByText('学习数据安全检查未通过')).toBeVisible()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
  await expect(page.getByText(/writes blocked/)).toBeVisible()
})

test('real app fails closed on corrupt pending V4 journal and never hydrates React', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    const target = { kind: 'account', accountId: 'corrupt-s1-target' }
    const source = await h.captureWorkingWorkspaceV4(target)
    await h.saveWorkspaceToVault(target, source)
    const vault = await h.openWorkspaceVault()
    await new Promise<void>((resolve, reject) => {
      const tx = vault.transaction('snapshots', 'readwrite')
      const request = tx.objectStore('snapshots').get('account:corrupt-s1-target')
      request.onsuccess = () => tx.objectStore('snapshots').put({ ...request.result, fingerprint: '0'.repeat(64) })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    vault.close()
    try {
      await h.switchWorkspace(h.workspaceRegistryPort, {
        flush: async () => {},
        saveSource: async () => {},
        restoreTarget: async () => { throw Error('crash during restore') },
      }, target)
    } catch {}
  })
  await page.goto('/')
  await expect(page.getByText('学习数据安全检查未通过')).toBeVisible()
  await expect(page.getByText(/integrity mismatch/)).toBeVisible()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
})

test('old V1 auth mutations are refused when isolated registry is initialized', async ({ page }) => {
  await harness(page)
  const status = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    let refused = false
    try { await h.assertLegacyAuthChangeAllowed() }
    catch { refused = true }
    const unchanged = await h.workspaceRegistryPort.read()
    return { refused, generation: unchanged.generation, active: unchanged.active }
  })
  expect(status).toEqual({ refused: true, generation: 1, active: { kind: 'anonymous' } })
})

test('S1 actual Settings login refuses legacy auth before any network request', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
  })
  let loginRequests = 0
  await page.route('**/api/auth/login', route => {
    loginRequests++
    void route.abort()
  })
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
  await page.getByPlaceholder('用户名').fill('new-user')
  await page.getByPlaceholder('密码（4-128字符）').fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText(/旧版账号操作已暂停/)).toBeVisible()
  expect(loginRequests).toBe(0)
})

test('isolated workspace blocks legacy V1 upload and local destructive actions', async ({ page }) => {
  await harness(page)
  const state = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    let blocked = 0
    for (const operation of [
      h.assertLegacyCloudMutationAllowed, h.assertLegacyLocalDestructiveOperationAllowed,
    ]) {
      try { await operation() } catch { blocked++ }
    }
    return { blocked, words: await h.db.wordRecords.count() }
  })
  expect(state).toEqual({ blocked: 2, words: 1 })
})
