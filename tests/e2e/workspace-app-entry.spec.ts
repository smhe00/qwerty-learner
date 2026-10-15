import { expect, test, type Page } from '@playwright/test'
import {
  readReviewModeInfo,
  startTyping,
  waitForActiveLearnSession,
  waitForRenderedWord,
} from './review-flow-harness'

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
  // S1 intentionally removes the old V1 credential form entirely.
  // Account changes only happen through the pre-mount guarded S1 page.
  await expect(page.getByPlaceholder('用户名')).toHaveCount(0)
  await expect(page.getByPlaceholder('密码（4-128字符）')).toHaveCount(0)
  // Anonymous S1 owners no longer see cloud sync copy or controls in Data.\n  await expect(page.getByText('云端同步', { exact: true })).toHaveCount(0)
  const safeEntry = page.locator('[data-account-entry]')
  await expect(safeEntry).toBeVisible()
  expect(loginRequests).toBe(0)
  // Account controls intentionally live outside the Settings modal. Close
  // Settings before using the top-right global account entry.
  // Keyboard dismissal works even when the header close icon is visually
  // hidden by the responsive transition/scroll container.
  await page.keyboard.press('Escape')
  await safeEntry.click()
  await expect(page.getByRole('heading', { name: '安全账户管理（S1）' })).toBeVisible()
  await expect(page.getByRole('button', { name: '登录已有账户' })).toBeVisible()
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
    const expired = Math.floor(Date.now() / 1000) - 120
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 's1-test-expired-token', expiresAt: expired,
      user: { userId: id, username: 'expiry-test-user' },
    }))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: id })
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
  // S1 explicitly requires confirmation of an existing complete V4 backup.
  // Never bypass this checkbox in a test or in production code.
  await page.getByLabel('已核对本机完整 V4 备份').check()
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
  // S1 explicitly requires confirmation of an existing complete V4 backup.
  // Never bypass this checkbox in a test or in production code.
  await page.getByLabel('已核对本机完整 V4 备份').check()
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


test('S1 fresh anonymous and new account both default to Shanghai 2027, explicit choices remain isolated', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    const before = await h.captureWorkingWorkspaceV4(h.ANONYMOUS)
    const target = { kind: 'account', accountId: 's1-shanghai-new-account' }
    const credential = {
      token: 'fixture-token-shanghai',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: target.accountId, username: 'shanghai-user' },
    }
    const lease = await h.acquireWorkspaceWriterLease()
    try {
      await h.switchAuthenticatedWorkspace(target, credential)
      const newAccount = JSON.parse(localStorage.getItem('currentDict') || 'null')
      // A deliberate selection must be retained by this account's V4 vault.
      localStorage.setItem('currentDict', JSON.stringify('cet4'))
      await h.switchAuthenticatedWorkspace(h.ANONYMOUS, null)
      const anonymousAfterLogout = JSON.parse(localStorage.getItem('currentDict') || 'null')
      await h.switchAuthenticatedWorkspace(target, credential)
      const accountAfterRelogin = JSON.parse(localStorage.getItem('currentDict') || 'null')
      return {
        anonymousBeforeLogin: before.workspaceData.navigation.currentDict,
        newAccount,
        anonymousAfterLogout,
        accountAfterRelogin,
        active: (await h.workspaceRegistryPort.read()).active,
      }
    } finally {
      lease.release()
    }
  })
  expect(result).toEqual({
    anonymousBeforeLogin: 'shanghai-zhongkao-2027',
    newAccount: 'shanghai-zhongkao-2027',
    anonymousAfterLogout: 'shanghai-zhongkao-2027',
    accountAfterRelogin: 'cet4',
    active: { kind: 'account', accountId: 's1-shanghai-new-account' },
  })
})

test('S1 anonymous to account switch commits auth only after registry activation', async ({ page }) => {
  await harness(page)
  const outcome = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    const target = { kind: 'account', accountId: 's1-switch-A' }
    const next = {
      token: 'test-credential', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: target.accountId, username: 'display-A' },
    }
    const lease = await h.acquireWorkspaceWriterLease()
    try {
      const stages = []
      const registry = await h.switchAuthenticatedWorkspace(target, next, (s: string) => stages.push(s))
      return {
        registry,
        stages,
        auth: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null'),
        intent: localStorage.getItem(h.S1_AUTH_INTENT_KEY),
        count: await h.db.wordRecords.count(),
        anonymousSaved: Boolean(await h.loadWorkspaceFromVault(h.ANONYMOUS)),
      }
    } finally { lease.release() }
  })
  expect(outcome.registry.active).toEqual({ kind: 'account', accountId: 's1-switch-A' })
  expect(outcome.stages).toEqual(['saving', 'prepared', 'restoring', 'complete'])
  expect(outcome.auth.user.userId).toBe('s1-switch-A')
  expect(outcome.intent).toBeNull()
  expect(outcome.count).toBe(0)
  expect(outcome.anonymousSaved).toBe(true)
})

test('S1 crash after journal but before identity commit reconciles on real boot', async ({ page }) => {
  await harness(page)
  const target = { kind: 'account', accountId: 's1-auth-crash-A' }
  const intermediate = await page.evaluate(async (target) => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    const intent = {
      version: 1, from: h.ANONYMOUS, to: target,
      nextAuth: {
        token: 'recovered-credential',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        user: { userId: target.accountId, username: 'after-crash' },
      },
    }
    localStorage.setItem(h.S1_AUTH_INTENT_KEY, JSON.stringify(intent))
    try {
      await h.switchWorkspace(h.workspaceRegistryPort, {
        flush: async () => {},
        saveSource: async () => {},
        restoreTarget: async () => { throw new Error('injected power failure') },
      }, target)
    } catch {}
    return { registry: await h.workspaceRegistryPort.read(), auth: localStorage.getItem('qwerty.cloudAuth.v1') }
  }, target)
  expect(intermediate.registry.pending?.to).toEqual(target)
  expect(intermediate.auth).toBeNull()
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  const state = await page.evaluate(async () => ({
    auth: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null'),
    intent: localStorage.getItem('qwerty.s1.auth-transition.v1'),
  }))
  expect(state.auth.user.userId).toBe(target.accountId)
  expect(state.intent).toBeNull()
})

test('S1 pre-journal auth intent crash rolls back without moving anonymous data', async ({ page }) => {
  await harness(page)
  const state = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    localStorage.setItem(h.S1_AUTH_INTENT_KEY, JSON.stringify({
      version: 1, from: h.ANONYMOUS, to: { kind: 'account', accountId: 's1-uncommitted' },
      nextAuth: {
        user: { userId: 's1-uncommitted', username: 'new' },
        token: 'never-committed', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    }))
    return h.reconcileAuthTransition()
  })
  expect(state).toBe('rolled-back')
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  expect((await page.evaluate(async () =>
    (window as any).__backupHarness.db.wordRecords.count()))).toBe(1)
})

test('S1 refuses direct account A to B and preserves original authentication', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    const authA = {
      token: 'account-A-token', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: 's1-test-A', username: 'A' },
    }
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify(authA))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: 's1-test-A' })
    const lease = await h.acquireWorkspaceWriterLease()
    let error = ''
    try {
      await h.switchAuthenticatedWorkspace({ kind: 'account', accountId: 's1-test-B' }, {
        token: 'B-token', expiresAt: authA.expiresAt,
        user: { userId: 's1-test-B', username: 'B' },
      })
    } catch(e) { error = String(e) } finally { lease.release() }
    return {
      error, auth: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null'),
      registry: await h.workspaceRegistryPort.read(),
      intent: localStorage.getItem(h.S1_AUTH_INTENT_KEY),
    }
  })
  expect(result.error).toMatch(/Explicit logout/)
  expect(result.auth.user.userId).toBe('s1-test-A')
  expect(result.registry.active).toEqual({ kind: 'account', accountId: 's1-test-A' })
  expect(result.intent).toBeNull()
})


test('actual S1 account UI login then offline logout preserves both local workspaces', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
  })
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      ok: true, user: { userId: 's1-ui-user-A', username: 'web-user' },
      token: 'test-login-token', expiresAt: Math.floor(Date.now()/1000)+3600, expiresIn:3600,
    }),
  }))
  let cloudMetaRequests = 0
  await page.route('**/api/sync/meta', route => {
    cloudMetaRequests += 1
    void route.abort()
  })
  page.on('dialog', dialog => { void dialog.accept() })
  await page.goto('/?s1-account=manage')
  await expect(page.getByText('安全账户管理（S1）')).toBeVisible()
  await page.getByRole('textbox', { name: '用户名' }).fill('web-user')
  await page.getByLabel('账户密码').fill('test-pass')
  await page.getByRole('button', { name: '登录已有账户' }).click()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  const afterLogin = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      active: (await h.workspaceRegistryPort.read()).active,
      wordCount: await h.db.wordRecords.count(),
      anonymousSaved: Boolean(await h.loadWorkspaceFromVault(h.ANONYMOUS)),
    }
  })
  expect(afterLogin).toEqual({
    active: { kind: 'account', accountId: 's1-ui-user-A' },
    wordCount: 0,
    anonymousSaved: true,
  })
  await page.goto('/?s1-account=manage')
  await page.getByRole('button', { name: '安全退出登录' }).click()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  const afterLogout = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      active: (await h.workspaceRegistryPort.read()).active,
      wordCount: await h.db.wordRecords.count(),
      auth: localStorage.getItem('qwerty.cloudAuth.v1'),
    }
  })
  expect(afterLogout).toEqual({
    active: { kind: 'anonymous' }, wordCount: 1, auth: null,
  })
  expect(cloudMetaRequests).toBe(0)
})

test('S1 cancelling logout preserves immutable owner and never renders PointerEvent toast', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'logout-cancel-fixture',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: 'logout-cancel-owner', username: 'cancel-account' },
    }))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: 'logout-cancel-owner' })
  })
  await page.goto('/')
  const account = page.locator('[data-account-entry]')
  await expect(account).toContainText('cancel-account')
  await account.click()
  await expect(page.getByRole('dialog', { name: '安全账户管理（S1）' })).toBeVisible()
  const back = page.getByRole('button', { name: '取消并返回学习' })
  let logoutConfirmShown = false
  page.once('dialog', async dialog => {
    logoutConfirmShown = true
    expect(dialog.message()).toContain('未同步学习进度')
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: '安全退出登录' }).click()
  await expect(page.getByRole('status')).toContainText('用户已取消退出')
  expect(logoutConfirmShown).toBe(true)
  const beforeBack = await page.evaluate(() => ({
    auth: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null').user.userId,
  }))
  expect(beforeBack.auth).toBe('logout-cancel-owner')
  await back.click()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  expect((await page.locator('body').innerText())).not.toContain('[object PointerEvent]')
  await harness(page)
  const after = await page.evaluate(async () => ({
    owner: (await (window as any).__backupHarness.workspaceRegistryPort.read()).active,
    auth: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null').user.userId,
  }))
  expect(after).toEqual({
    owner: { kind: 'account', accountId: 'logout-cancel-owner' },
    auth: 'logout-cancel-owner',
  })
})

test('fresh EdgeOne origin opens S1 login without inventing nonexistent V1 migration', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-account-entry]')).toBeVisible()
  let authCalls = 0
  await page.route('**/api/auth/**', route => { authCalls++; void route.abort() })
  await page.locator('[data-account-entry]').click()
  await expect(page.getByText('安全账户管理（S1）')).toBeVisible()
  await expect(page.getByText('S1 V1 数据归属测试（仅限本地开发）')).toHaveCount(0)
  expect(authCalls).toBe(0)
  const result = await page.evaluate(async () => {
    const request = indexedDB.open('QwertyPlusWorkspaceVaultV1')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const tx = db.transaction('registry', 'readonly')
      const req = tx.objectStore('registry').get('head')
      const registry = await new Promise<any>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      return registry
    } finally { db.close() }
  })
  expect(result.generation).toBe(1)
  expect(result.active).toEqual({ kind: 'anonymous' })
})

test('P0: fresh browser studies a word anonymously then opens S1 login without V1 consent or record loss', async ({ page }) => {
  // Start from an untouched browser origin. Auto-initialization must precede
  // any Learn database writer, not be delayed until the first Login click.
  await page.goto('/')
  await expect(page.locator('[data-account-entry]')).toBeVisible()
  await page.goto('/learn')
  const info = await waitForActiveLearnSession(page)
  const firstWord = info.reviewRecord.words[0]?.name as string
  expect(firstWord).toBeTruthy()
  await startTyping(page)
  await waitForRenderedWord(page, firstWord)
  await page.keyboard.type(firstWord)
  await expect.poll(async () => {
    const state = await readReviewModeInfo(page)
    return state?.reviewRecord?.index ?? 0
  }).toBeGreaterThan(0)

  // The completed spelling must be durable, not only visible in React.
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const tx = db.transaction('wordRecords', 'readonly')
      const request = tx.objectStore('wordRecords').count()
      return await new Promise<number>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })).toBeGreaterThan(0)

  const learnedBeforeLogin = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const request = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').count()
      return await new Promise<number>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
  await page.locator('[data-account-entry]').click()
  await expect(page.getByRole('dialog', { name: '安全账户管理（S1）' })).toBeVisible()
  await expect(page.getByText(/V1.*数据归属/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '登录已有账户' })).toBeVisible()
  await harness(page)
  const after = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      registry: await h.workspaceRegistryPort.read(),
      count: await h.db.wordRecords.count(),
      anonymous: Boolean(await h.loadWorkspaceFromVault(h.ANONYMOUS)),
    }
  })
  expect(after.registry.active).toEqual({ kind: 'anonymous' })
  expect(after.registry.generation).toBe(1)
  expect(after.anonymous).toBe(true)
  expect(after.count).toBe(learnedBeforeLogin)
})

test('fresh anonymous Learn-mode preference is not mistaken for a V1 checkpoint', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    // Jotai omits undefined reviewRecord during storage serialization.
    localStorage.setItem('reviewModeInfo', JSON.stringify({ isReviewMode: true }))
  })
  await page.locator('[data-account-entry]').click()
  await expect(page.getByText('安全账户管理（S1）')).toBeVisible()
  await expect(page.getByText('S1 V1 数据归属测试（仅限本地开发）')).toHaveCount(0)
})

test('old V1 study data still requires explicit S1 ownership consent before login', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => (window as any).__backupHarness.seed())
  await page.goto('/')
  await page.locator('[data-account-entry]').click()
  await expect(page.getByText('S1 V1 数据归属测试（仅限本地开发）')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认归属并建立隔离工作区' })).toBeDisabled()
  await page.getByRole('button', { name: '取消，保持 V1' }).click()
  await expect(page.locator('[data-account-entry]')).toBeVisible()
})

test('pre-existing V1 Learn checkpoint cannot be auto-initialized as fresh S1', async ({ page }) => {
  // Simulate a PRE-S1 browser with a durable checkpoint before app boot.
  await harness(page)
  await page.evaluate(() => {
    localStorage.setItem('qwerty.learn.dailySession.v1.cet4', '{"version":1}')
  })
  await page.goto('/')
  await page.locator('[data-account-entry]').click()
  await expect(page.getByText('S1 V1 数据归属测试（仅限本地开发）')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认归属并建立隔离工作区' })).toBeDisabled()
})


test('S1 registration explicitly copies full anonymous V4 data, preserving original', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
  })
  await page.route('**/api/auth/register', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      ok: true, user: { userId: 's1-fresh-registered-ID', username: 'new-username' },
      token: 'registration-token', expiresAt: Math.floor(Date.now()/1000)+3600, expiresIn:3600,
    }),
  }))
  page.on('dialog', dialog => { void dialog.accept() })
  await page.goto('/?s1-account=manage')
  await page.getByRole('textbox', { name: '用户名' }).fill('new-username')
  await page.getByLabel('账户密码').fill('test-pass')
  await page.getByLabel('注册密码确认').fill('test-pass')
  await page.getByRole('button', { name: '注册新账户' }).click()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  const outcome = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const registry = await h.workspaceRegistryPort.read()
    return {
      owner: registry.active,
      accountCount: await h.db.wordRecords.count(),
      anonymousSaved: Boolean(await h.loadWorkspaceFromVault(h.ANONYMOUS)),
    }
  })
  expect(outcome).toEqual({
    owner: { kind: 'account', accountId: 's1-fresh-registered-ID' },
    accountCount: 1,
    anonymousSaved: true,
  })
})

test('S1 failed cloud login does not modify anonymous workspace', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
  })
  await page.route('**/api/auth/login', route => route.fulfill({
    status: 401, contentType: 'application/json',
    body: JSON.stringify({ error: 'invalid_credentials', message: 'Invalid credentials' }),
  }))
  await page.goto('/?s1-account=manage')
  await page.getByRole('textbox', { name: '用户名' }).fill('invalid')
  await page.getByLabel('账户密码').fill('wrongpassword')
  await page.getByRole('button', { name: '登录已有账户' }).click()
  await expect(page.getByRole('status')).toContainText('操作未完成')
  await harness(page)
  const outcome = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      active: (await h.workspaceRegistryPort.read()).active,
      records: await h.db.wordRecords.count(),
      auth: localStorage.getItem('qwerty.cloudAuth.v1'),
      intent: localStorage.getItem(h.S1_AUTH_INTENT_KEY),
    }
  })
  expect(outcome).toEqual({
    active: { kind: 'anonymous' }, records: 1, auth: null, intent: null,
  })
})

test('S1 same immutable account reauth rejects a different userId', async ({ page }) => {
  await harness(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    const auth = {
      token: 'tokenA', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: 's1-current-A', username: 'A' },
    }
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify(auth))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: 's1-current-A' })
    let error = ''
    try {
      await h.reauthenticateSameWorkspace({
        ...auth, token: 'tokenB', user: { userId: 's1-other-B', username: 'B' },
      })
    } catch (e) { error = String(e) }
    return {
      error, auth: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null'),
    }
  })
  expect(result.error).toMatch(/Reauthentication may not change/)
  expect(result.auth.user.userId).toBe('s1-current-A')
})


test('S1 A -> anonymous -> B -> anonymous -> A preserves three full local identities', async ({ page }) => {
  await harness(page)
  const observed = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    const expiry = Math.floor(Date.now() / 1000) + 3600
    const auth = (id: string) => ({
      token: 'fixture-token-' + id, expiresAt: expiry,
      user: { userId: id, username: 'shared-display-name' },
    })
    const lease = await h.acquireWorkspaceWriterLease()
    try {
      const a = { kind: 'account', accountId: 'S1-A' }
      const b = { kind: 'account', accountId: 'S1-B' }
      await h.switchAuthenticatedWorkspace(a, auth('S1-A'))
      await h.db.wordRecords.add({
        word: 'A-ONLY', dict: 'cet4', chapter: -1, timeStamp: 1,
        timing: [101], wrongCount: 0, mistakes: {},
      })
      localStorage.setItem('memoryConfig', JSON.stringify({
        dailyNewWordTarget: 7, blockSize: 2,
      }))
      await h.switchAuthenticatedWorkspace(h.ANONYMOUS, null)
      const anonymous = {
        words: (await h.db.wordRecords.toArray()).map((r: any) => r.word),
        memory: localStorage.getItem('memoryConfig'),
      }
      await h.switchAuthenticatedWorkspace(b, auth('S1-B'))
      const bInitiallyEmpty = (await h.db.wordRecords.count()) === 0
      await h.db.wordRecords.add({
        word: 'B-ONLY', dict: 'cet4', chapter: -1, timeStamp: 2,
        timing: [102], wrongCount: 0, mistakes: {},
      })
      localStorage.setItem('memoryConfig', JSON.stringify({
        dailyNewWordTarget: 34, blockSize: 4,
      }))
      await h.switchAuthenticatedWorkspace(h.ANONYMOUS, null)
      await h.switchAuthenticatedWorkspace(a, auth('S1-A'))
      const restoredA = {
        words: (await h.db.wordRecords.toArray()).map((r: any) => r.word),
        memory: JSON.parse(localStorage.getItem('memoryConfig') || 'null'),
      }
      await h.switchAuthenticatedWorkspace(h.ANONYMOUS, null)
      await h.switchAuthenticatedWorkspace(b, auth('S1-B'))
      const restoredB = {
        words: (await h.db.wordRecords.toArray()).map((r: any) => r.word),
        memory: JSON.parse(localStorage.getItem('memoryConfig') || 'null'),
        authId: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null')?.user?.userId,
      }
      return { anonymous, bInitiallyEmpty, restoredA, restoredB }
    } finally { lease.release() }
  })
  expect(observed.anonymous.words).toContain('backup-fsrs-word')
  expect(observed.anonymous.words).not.toContain('A-ONLY')
  expect(observed.anonymous.words).not.toContain('B-ONLY')
  expect(observed.anonymous.memory).toBeNull()
  expect(observed.bInitiallyEmpty).toBe(true)
  expect(observed.restoredA.words).toContain('A-ONLY')
  expect(observed.restoredA.words).not.toContain('B-ONLY')
  expect(observed.restoredA.words).not.toContain('backup-fsrs-word')
  expect(observed.restoredA.memory.dailyNewWordTarget).toBe(7)
  expect(observed.restoredB.words).toContain('B-ONLY')
  expect(observed.restoredB.words).not.toContain('A-ONLY')
  expect(observed.restoredB.memory.dailyNewWordTarget).toBe(34)
  expect(observed.restoredB.authId).toBe('S1-B')
})


test('S1 protected owner undoes stale V5 cross-tab localStorage setting/auth writes', async ({ page, context }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('memoryConfig', JSON.stringify({
      dailyNewWordTarget: 19, blockSize: 1,
    }))
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()

  // Stale V5 has no writer lease, and cannot open the upgraded V6 DB.
  // But it still has ordinary access to same-origin localStorage.
  const stale = await context.newPage()
  await stale.goto('/tests/e2e/legacy-v5.html')
  await stale.evaluate(() => {
    localStorage.setItem('memoryConfig', JSON.stringify({
      dailyNewWordTarget: 999, blockSize: 100,
    }))
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'forbidden-stale-owner',
      expiresAt: Math.floor(Date.now()/1000) + 3600,
      user: { userId: 'FOREIGN-OWNER', username: 'stale' },
    }))
  })
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('memoryConfig') || 'null')?.dailyNewWordTarget,
  )).toBe(19)
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('qwerty.cloudAuth.v1'),
  )).toBeNull()
  await stale.close()

  await page.reload()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      owner: (await h.workspaceRegistryPort.read()).active,
      learningRows: await h.db.wordRecords.count(),
      config: JSON.parse(localStorage.getItem('memoryConfig') || 'null'),
    }
  })
  expect(result.owner).toEqual({ kind: 'anonymous' })
  expect(result.learningRows).toBe(1)
  expect(result.config).toEqual({ dailyNewWordTarget: 19, blockSize: 1 })
})


test('S1 boot finalizes account identity after target CAS succeeded but auth write crashed', async ({ page }) => {
  await harness(page)
  const accountId = 'S1-CAS-before-auth-identity'
  const preBoot = await page.evaluate(async (id) => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    const target = { kind: 'account', accountId: id }
    localStorage.setItem(h.S1_AUTH_INTENT_KEY, JSON.stringify({
      version: 1,
      from: h.ANONYMOUS,
      to: target,
      nextAuth: {
        token: 'session-recovered-after-CAS',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        user: { userId: id, username: 'recovered-after-CAS' },
      },
    }))
    const lease = await h.acquireWorkspaceWriterLease()
    try { await h.transitionWorkingWorkspace(target) }
    finally { lease.release() }
    return {
      registry: await h.workspaceRegistryPort.read(),
      auth: localStorage.getItem('qwerty.cloudAuth.v1'),
      intentPresent: localStorage.getItem(h.S1_AUTH_INTENT_KEY) !== null,
      records: await h.db.wordRecords.count(),
    }
  }, accountId)
  expect(preBoot.registry.active).toEqual({ kind: 'account', accountId })
  expect(preBoot.registry.pending).toBeNull()
  expect(preBoot.auth).toBeNull()
  expect(preBoot.intentPresent).toBe(true)
  expect(preBoot.records).toBe(0)

  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      owner: (await h.workspaceRegistryPort.read()).active,
      auth: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null'),
      pendingIntent: localStorage.getItem(h.S1_AUTH_INTENT_KEY),
      anonymousSaved: Boolean(await h.loadWorkspaceFromVault(h.ANONYMOUS)),
      records: await h.db.wordRecords.count(),
    }
  })
  expect(result.owner).toEqual({ kind: 'account', accountId })
  expect(result.auth.user.userId).toBe(accountId)
  expect(result.pendingIntent).toBeNull()
  expect(result.anonymousSaved).toBe(true)
  expect(result.records).toBe(0)
})

test('S1 corrupt auth transition intent fails closed before mounting writers', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    localStorage.setItem(h.S1_AUTH_INTENT_KEY, '{incomplete-json')
  })
  await page.goto('/')
  await expect(page.getByText('学习数据安全检查未通过')).toBeVisible()
  await expect(page.getByText(/Corrupt S1 auth transition intent/)).toBeVisible()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
  await harness(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      owner: (await h.workspaceRegistryPort.read()).active,
      count: await h.db.wordRecords.count(),
      intentStillPresent: localStorage.getItem(h.S1_AUTH_INTENT_KEY) !== null,
    }
  })
  expect(result).toEqual({
    owner: { kind: 'anonymous' }, count: 1, intentStillPresent: true,
  })
})


test('S1 old tab localStorage.clear blocks remount instead of silently losing Learn state', async ({ page, context }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  const oldTab = await context.newPage()
  await oldTab.goto('/tests/e2e/legacy-v5.html')
  await oldTab.evaluate(() => localStorage.clear())
  await expect(page.getByText('学习数据安全检查未通过')).toBeVisible()
  await expect(page.getByText(/older tab clearing shared localStorage/)).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('qwerty.s1.foreign-storage-clear-blocked'))).toBe('1')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
  await oldTab.close()
})


test('S1 migration witness rejects old-tab storage clear after owner has closed', async ({ page, context }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('qwerty.s1.workspace-migrated.v1'))).toMatch(/^v2:[0-9a-f]{16}$/)
  const oldTab = await context.newPage()
  await oldTab.goto('/tests/e2e/legacy-v5.html')
  await page.close()
  await oldTab.evaluate(() => localStorage.clear())
  await oldTab.close()
  const next = await context.newPage()
  await next.goto('/')
  await expect(next.getByText('学习数据安全检查未通过')).toBeVisible()
  await expect(next.getByText(/workspace migration witness missing/)).toBeVisible()
  await expect(next.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
  await next.close()
})


test('S1 never treats a deleted vault registry as a fresh anonymous V1 profile', async ({ page }) => {
  await harness(page)
  const state = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    return {
      migrated: localStorage.getItem('qwerty.s1.workspace-migrated.v1'),
      records: await h.db.wordRecords.count(),
    }
  })
  expect(state.migrated).toMatch(/^v2:[0-9a-f]{16}$/)
  expect(state.records).toBe(1)
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('QwertyPlusWorkspaceVaultV1')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Vault still has open transactions'))
    })
  })
  await page.goto('/')
  await expect(page.getByText('学习数据安全检查未通过')).toBeVisible()
  await expect(page.getByText(/vault registry missing.*legacy fallback refused/)).toBeVisible()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
  await harness(page)
  expect(await page.evaluate(async () =>
    (window as any).__backupHarness.db.wordRecords.count())).toBe(1)
})


test('S1 seal detects stale V5 settings modification after the owner tab closes', async ({ page, context }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('memoryConfig', JSON.stringify({ blockSize: 1, dailyNewWordTarget: 19 }))
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('qwerty.s1.workspace-migrated.v1'))).toMatch(/^v2:[0-9a-f]{16}$/)

  const oldTab = await context.newPage()
  await oldTab.goto('/tests/e2e/legacy-v5.html')
  await page.close()
  await oldTab.evaluate(() => {
    localStorage.setItem('memoryConfig', JSON.stringify({ blockSize: 100, dailyNewWordTarget: 999 }))
  })
  await oldTab.close()

  const reopened = await context.newPage()
  await reopened.goto('/')
  await expect(reopened.getByText('学习数据安全检查未通过')).toBeVisible()
  await expect(reopened.getByText(/storage witness mismatch/)).toBeVisible()
  await expect(reopened.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
  await harness(reopened)
  expect(await reopened.evaluate(async () =>
    (window as any).__backupHarness.db.wordRecords.count())).toBe(1)
  await reopened.close()
})


test('P0: new anonymous learner clears recorded words through S1 journal and keeps workspaces valid', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await page.goto('/learn')
  const active = await waitForActiveLearnSession(page)
  const firstWord = active.reviewRecord.words[0].name as string
  await startTyping(page)
  await waitForRenderedWord(page, firstWord)
  await page.keyboard.type(firstWord)
  await expect.poll(async () => (await readReviewModeInfo(page))?.reviewRecord?.index ?? 0)
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
  await page.getByText('高级操作 · 清除本地数据').click()
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click()
  await expect(page.getByRole('heading', { name: '清除当前工作区的本地学习数据' }))
    .toBeVisible()
  const reset = page.getByRole('button', { name: '确认清除本地学习数据' })
  await expect(reset).toBeDisabled()
  await page.getByLabel('我确认仅清除当前工作区的本地学习记录').check()
  await expect(reset).toBeEnabled()
  page.once('dialog', dialog => dialog.accept())
  await reset.click()
  await expect(page.getByText(/当前工作区的本地学习记录已清除/))
    .toBeVisible({ timeout: 40_000 })
  await harness(page)
  const after = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const registry = await h.workspaceRegistryPort.read()
    const snapshot = await h.captureWorkingWorkspaceV4(h.ANONYMOUS)
    const tables = (snapshot.workspaceData.database as any).data.data as
      Array<{ tableName: string; rows: unknown[] }>
    return {
      rows: tables.map(t => ({ name: t.tableName, count: t.rows.length })),
      sessions: Object.keys(snapshot.workspaceData.learnRuntime.dailySessions),
      navigation: snapshot.workspaceData.navigation,
      registry,
      pending: await h.manualV4ImportJournalPort.read(),
      backup: Boolean(await h.loadWorkspaceFromVault(h.ANONYMOUS)),
    }
  })
  expect(after.rows).toHaveLength(6)
  expect(after.rows.every(t => t.count === 0)).toBe(true)
  expect(after.sessions).toEqual([])
  expect(after.navigation).toEqual({ currentDict: 'shanghai-zhongkao-2027', currentChapter: 0 })
  expect(after.registry.active).toEqual({ kind: 'anonymous' })
  expect(after.registry.generation).toBe(1)
  expect(after.pending).toBeNull()
  expect(after.backup).toBe(true)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await expect(page.getByText('学习数据安全检查未通过')).toHaveCount(0)
})

test('P0: S1 clear cancellation retains the exact original workspace', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
  })
  await page.goto('/?s1-clear=manage')
  await expect(page.getByRole('heading', { name: '清除当前工作区的本地学习数据' }))
    .toBeVisible()
  await page.getByRole('button', { name: '取消，返回学习' }).click()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await harness(page)
  const before = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return { records: await h.db.wordRecords.count(),
      journal: await h.manualV4ImportJournalPort.read() }
  })
  expect(before).toEqual({ records: 1, journal: null })
})

test('P0: S1 local clear leaves other saved account vault and authentication unchanged', async ({ page }) => {
  await harness(page)
  const identity = { kind: 'account' as const, accountId: 'account-preserved-on-clear' }
  await page.evaluate(async (id) => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    const account = { kind: 'account', accountId: id }
    const snapshot = await h.captureWorkingWorkspaceV4(account)
    await h.saveWorkspaceToVault(account, snapshot)
  }, identity.accountId)
  await page.goto('/?s1-clear=manage')
  await expect(page.getByText('LOCAL-ANONYMOUS')).toBeVisible()
  await page.getByLabel('我确认仅清除当前工作区的本地学习记录').check()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '确认清除本地学习数据' }).click()
  await expect(page.getByText(/当前工作区的本地学习记录已清除/))
    .toBeVisible({ timeout: 40_000 })
  await harness(page)
  const result = await page.evaluate(async id => {
    const h = (window as any).__backupHarness
    const account = await h.loadWorkspaceFromVault({ kind: 'account', accountId: id })
    return {
      current: await h.db.wordRecords.count(),
      otherRecords: (account?.workspaceData.database as any)?.data?.data
        ?.find((row: any) => row.tableName === 'wordRecords')?.rows?.length,
      registry: await h.workspaceRegistryPort.read(),
      pending: await h.manualV4ImportJournalPort.read(),
    }
  }, identity.accountId)
  expect(result.current).toBe(0)
  expect(result.otherRecords).toBe(1)
  expect(result.registry.active).toEqual({ kind: 'anonymous' })
  expect(result.pending).toBeNull()
})
