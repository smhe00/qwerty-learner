import { expect, test, type Page } from '@playwright/test'

const accountA = { kind: 'account' as const, accountId: 's1-boot-account-A' }

async function ready(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.mountGuardedWorkspaceApp),
  )).toBe(true)
}

test('uninitialized legacy working DB fails closed before the mount callback', async ({ page }) => {
  await ready(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    const before = (await h.db.wordRecords.toArray()).length
    let mounted = false
    const stages: string[] = []
    let error = ''
    try {
      await h.mountGuardedWorkspaceApp(() => { mounted = true }, (stage: string) => stages.push(stage))
    } catch (e) { error = String(e) }
    return { before, after: (await h.db.wordRecords.toArray()).length, mounted, error, stages }
  })
  expect(result).toMatchObject({
    before: 1, after: 1, mounted: false,
    stages: ['locking', 'blocked'],
  })
  expect(result.error).toMatch(/explicit V1 migration/)
})

test('initialized anonymous workspace mounts only after exclusive lock and recovery', async ({ page }) => {
  await ready(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    const stages: string[] = []
    const boot = await h.mountGuardedWorkspaceApp(async (registry: any) => {
      stages.push('mounted')
      if (registry.pending !== null) throw Error('journal still pending')
      if ((await h.db.wordRecords.count()) !== 1) throw Error('data lost before mount')
    }, (stage: string) => stages.push(stage))
    const generation = boot.registry.generation
    boot.release()
    return { stages, generation }
  })
  expect(result).toEqual({
    stages: ['locking', 'recovering', 'checking-identity', 'ready', 'mounted'],
    generation: 1,
  })
})

test('a second tab cannot mount or write while first tab retains writer lease', async ({ page, context }) => {
  await ready(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    ;(window as any).__s1Boot = await h.mountGuardedWorkspaceApp(() => {})
  })
  const second = await context.newPage()
  await ready(second)
  const refused = await second.evaluate(async () => {
    const h = (window as any).__backupHarness
    let mounted = false
    let error = ''
    try { await h.mountGuardedWorkspaceApp(() => { mounted = true }) }
    catch (e) { error = String(e) }
    return { mounted, error }
  })
  expect(refused.mounted).toBe(false)
  expect(refused.error).toMatch(/Another tab owns/)
  await page.evaluate(() => (window as any).__s1Boot.release())
  const accepted = await second.evaluate(async () => {
    const h = (window as any).__backupHarness
    let mounted = false
    const boot = await h.mountGuardedWorkspaceApp(() => { mounted = true })
    boot.release()
    return mounted
  })
  expect(accepted).toBe(true)
  await second.close()
})

test('pending crash journal is replayed before mount on fresh navigation', async ({ page }) => {
  await ready(page)
  const initial = await page.evaluate(async (a) => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    try {
      await h.switchWorkspace(h.workspaceRegistryPort, {
        flush: async () => {},
        saveSource: async () => {},
        restoreTarget: async () => { throw Error('injected crash after journal commit') },
      }, a)
    } catch { /* Simulated power loss during target restore. */ }
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'test-token', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: a.accountId, username: 'test-user' },
    }))
    return h.workspaceRegistryPort.read()
  }, accountA)
  expect(initial.pending?.to).toEqual(accountA)
  await page.reload()
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.mountGuardedWorkspaceApp),
  )).toBe(true)
  const recovered = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const events: string[] = []
    const boot = await h.mountGuardedWorkspaceApp(async (r: any) => {
      events.push('mounted')
      if (r.pending) throw Error('mounted before recovery')
      if ((await h.db.wordRecords.count()) !== 0) throw Error('A inherited anonymous records')
    }, (s: string) => events.push(s))
    const value = boot.registry
    const anonymous = await h.loadWorkspaceFromVault(h.ANONYMOUS)
    boot.release()
    return { value, events, anonymousSaved: Boolean(anonymous) }
  })
  expect(recovered.value.pending).toBeNull()
  expect(recovered.value.active).toEqual(accountA)
  expect(recovered.value.generation).toBe(3)
  expect(recovered.events).toEqual(['locking', 'recovering', 'checking-identity', 'ready', 'mounted'])
  expect(recovered.anonymousSaved).toBe(true)
})

test('auth mismatch blocks all writers without changing existing workspace', async ({ page }) => {
  await ready(page)
  const result = await page.evaluate(async (a) => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'test-token', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: a.accountId, username: 'test-user' },
    }))
    let mounted = false
    let error = ''
    try { await h.mountGuardedWorkspaceApp(() => { mounted = true }) }
    catch (e) { error = String(e) }
    return {
      mounted, error, count: await h.db.wordRecords.count(),
      registry: await h.workspaceRegistryPort.read(),
    }
  }, accountA)
  expect(result.mounted).toBe(false)
  expect(result.error).toMatch(/writes blocked/)
  expect(result.count).toBe(1)
  expect(result.registry.active).toEqual({ kind: 'anonymous' })
})

test('corrupt pending target blocks mount and retains replay journal', async ({ page }) => {
  await ready(page)
  const result = await page.evaluate(async (a) => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    const snapshot = await h.captureWorkingWorkspaceV4(a)
    await h.saveWorkspaceToVault(a, snapshot)
    const vault = await h.openWorkspaceVault()
    await new Promise<void>((resolve, reject) => {
      const tx = vault.transaction('snapshots', 'readwrite')
      const store = tx.objectStore('snapshots')
      const req = store.get('account:' + encodeURIComponent(a.accountId))
      req.onsuccess = () => store.put({ ...req.result, fingerprint: 'f'.repeat(64) })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    vault.close()
    try {
      await h.switchWorkspace(h.workspaceRegistryPort, {
        flush: async () => {},
        saveSource: async () => {},
        restoreTarget: async () => { throw Error('injected crash') },
      }, a)
    } catch {}
    let mounted = false
    let error = ''
    try { await h.mountGuardedWorkspaceApp(() => { mounted = true }) }
    catch (e) { error = String(e) }
    return { mounted, error, registry: await h.workspaceRegistryPort.read(),
      wordCount: await h.db.wordRecords.count() }
  }, accountA)
  expect(result.mounted).toBe(false)
  expect(result.error).toMatch(/integrity mismatch/)
  expect(result.registry.pending?.to).toEqual(accountA)
  expect(result.wordCount).toBe(1)
})
