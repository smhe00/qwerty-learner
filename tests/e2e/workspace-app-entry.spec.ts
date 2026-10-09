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

test('actual app replays pending S1 switch then reloads with isolated account state', async ({ page }) => {
  await harness(page)
  const target = { kind: 'account', accountId: 's1-happy-crash-target' }
  const pending = await page.evaluate(async (account) => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    try {
      await h.switchWorkspace(h.workspaceRegistryPort, {
        flush: async () => {},
        saveSource: async () => {},
        restoreTarget: async () => { throw new Error('injected crash after durable journal') },
      }, account)
    } catch { /* Deliberately leave pending journal to be recovered by real boot. */ }
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 's1-harness-credential', expiresAt: Math.floor(Date.now()/1000) + 3600,
      user: { userId: account.accountId, username: 'test-account' },
    }))
    return h.workspaceRegistryPort.read()
  }, target)
  expect(pending.pending?.to).toEqual(target)
  expect(pending.active).toEqual({ kind: 'anonymous' })

  // Boot must restore account A in the unmounted phase and force fresh
  // navigation before any React/Jotai state is constructed.
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 15_000 })
  await harness(page)
  const settled = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const registry = await h.workspaceRegistryPort.read()
    return {
      registry,
      wordCount: await h.db.wordRecords.count(),
      anonymousVaultPreserved: Boolean(await h.loadWorkspaceFromVault(h.ANONYMOUS)),
    }
  })
  expect(settled.registry.pending).toBeNull()
  expect(settled.registry.active).toEqual(target)
  expect(settled.registry.generation).toBe(3)
  expect(settled.wordCount).toBe(0)
  expect(settled.anonymousVaultPreserved).toBe(true)
})


test('S1 keeps an expired account workspace locally owned, without silent sign-out', async ({ page }) => {
  await harness(page)
  const accountId = 's1-expired-account'
  await page.evaluate(async (id) => {
    const h = (window as any).__backupHarness
    await h.seed()
    const future = Math.floor(Date.now() / 1000) + 3600
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 's1-test-expired-token', expiresAt: future,
      user: { userId: id, username: 'expiry-test-user' },
    }))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: id })
    const expired = Math.floor(Date.now() / 1000) - 120
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 's1-test-expired-token', expiresAt: expired,
      user: { userId: id, username: 'expiry-test-user' },
    }))
  }, accountId)

  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  const state = await page.evaluate(() => ({
    userId: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}').user?.userId,
    retention: sessionStorage.getItem('qwerty.s1.isolated-auth-retention'),
  }))
  expect(state).toEqual({ userId: accountId, retention: '1' })

  await harness(page)
  const registry = await page.evaluate(() => (window as any).__backupHarness.workspaceRegistryPort.read())
  expect(registry.active).toEqual({ kind: 'account', accountId })
})

test('S1 rejects a mismatched expired identity rather than silently using anonymous', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 's1-initial-token', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: 's1-real-owner', username: 'real-owner' },
    }))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: 's1-real-owner' })
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 's1-expired-different-owner', expiresAt: Math.floor(Date.now() / 1000) - 20,
      user: { userId: 's1-other-owner', username: 'other-owner' },
    }))
  })
  await page.goto('/')
  await expect(page.getByText('学习数据安全检查未通过')).toBeVisible()
  await expect(page.getByText(/writes blocked/)).toBeVisible()
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}').user?.userId,
  )).toBe('s1-other-owner')
})

test('pagehide never releases a mounted app writer lock before writer quiescence', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
  })
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByText('另一个标签页正在使用学习数据')).toBeVisible()
  await page.close()
  await second.getByRole('button', { name: '重试' }).click()
  await expect(second.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await second.close()
})


test('real S1 pre-mount consent preserves anonymous V1 learning records', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => (window as any).__backupHarness.seed())
  await page.goto('/?s1-migration=confirm')
  await expect(page.getByText('S1 V1 数据归属测试（仅限本地开发）')).toBeVisible()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
  await page.getByRole('button', { name: '确认归属并建立隔离工作区' }).click()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      registry: await h.workspaceRegistryPort.read(),
      records: await h.db.wordRecords.count(),
      saved: Boolean(await h.loadWorkspaceFromVault(h.ANONYMOUS)),
    }
  })
  expect(result.registry.active).toEqual({ kind: 'anonymous' })
  expect(result.registry.generation).toBe(1)
  expect(result.records).toBe(1)
  expect(result.saved).toBe(true)
})

test('S1 dev consent assigns V1 account workspace by immutable ID, not username', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 's1-dev-account-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: 's1-immutable-identity-A', username: 'display-name' },
    }))
  })
  await page.goto('/?s1-migration=confirm')
  await expect(page.getByText(/s1-immutable-identity-A/)).toBeVisible()
  await page.getByRole('button', { name: '确认归属并建立隔离工作区' }).click()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      registry: await h.workspaceRegistryPort.read(),
      records: await h.db.wordRecords.count(),
      saved: Boolean(await h.loadWorkspaceFromVault({
        kind: 'account', accountId: 's1-immutable-identity-A',
      })),
    }
  })
  expect(result.registry.active).toEqual({
    kind: 'account', accountId: 's1-immutable-identity-A',
  })
  expect(result.registry.generation).toBe(1)
  expect(result.records).toBe(1)
  expect(result.saved).toBe(true)
})

test('cancelling S1 pre-mount ownership consent leaves V1 unchanged', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => (window as any).__backupHarness.seed())
  await page.goto('/?s1-migration=confirm')
  await page.getByRole('button', { name: '取消，保持 V1' }).click()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  const state = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return { registry: await h.workspaceRegistryPort.read(), records: await h.db.wordRecords.count() }
  })
  expect(state.registry.generation).toBe(0)
  expect(state.records).toBe(1)
})


test('real V5 old-JS tab cannot reopen or mutate RecordDB after V6 S1 rollout fence', async ({ page, context }) => {
  // The first tab uses the actual previous Dexie schema and no S1 Web Lock.
  // The second tab loads the new guarded real app; versionchange must retire
  // the obsolete connection before it is allowed to own V6 writes.
  await page.goto('/tests/e2e/legacy-v5.html')
  await expect.poll(() => page.evaluate(() => (window as any).__legacyV5?.opened)).toBe(true)
  const before = await page.evaluate(() => (window as any).__legacyV5.tryWordWrite('before-v6'))
  expect(before).toBe('WRITTEN')

  const next = await context.newPage()
  await next.goto('/')
  await expect(next.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__legacyV5?.versionChangeCount)).toBeGreaterThan(0)
  const attempt = await page.evaluate(() => (window as any).__legacyV5.tryWordWrite('forbidden-after-v6'))
  expect(attempt).not.toBe('WRITTEN')
  expect(attempt).toMatch(/VersionError|DatabaseClosedError|version|closed/i)

  await next.close()
  await harness(page)
  const result = await page.evaluate(async () => {
    const db = (window as any).__backupHarness.db
    return { version: db.verno, words: (await db.wordRecords.toArray()).map((item: any) => item.word) }
  })
  expect(result.version).toBe(6)
  expect(result.words).toContain('before-v6')
  expect(result.words).not.toContain('forbidden-after-v6')
})
