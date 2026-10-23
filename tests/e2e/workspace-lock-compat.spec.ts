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
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' }))
    .toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('学习数据安全检查未通过')).toHaveCount(0)
})

test('P0: standard SHA-256 V4 fingerprints are bit-for-bit identical without SubtleCrypto', async ({ page }) => {
  await harness(page)
  await page.addScriptTag({
    type: 'module',
    content: [
      "import { sha256Portable, sha256Hex } from '/src/sync/sha256-compat.ts'",
      'window.__s1Sha256 = { sha256Portable, sha256Hex }',
    ].join('\n'),
  })
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__s1Sha256?.sha256Portable),
  )).toBe(true)
  const fingerprints = await page.evaluate(async () => {
    const utils = (window as any).__s1Sha256
    const vectors = [
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      ['The quick brown fox jumps over the lazy dog',
        'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
    ]
    const encoder = new TextEncoder()
    const checked = []
    for (const [message, expected] of vectors) {
      const bytes = encoder.encode(message)
      checked.push({
        expected,
        native: await utils.sha256Hex(bytes),
        portable: utils.sha256Portable(bytes),
      })
    }
    const million = new Uint8Array(1_000_000).fill(97)
    checked.push({
      expected: 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
      native: await utils.sha256Hex(million),
      portable: utils.sha256Portable(million),
    })
    const unicode = encoder.encode('中文🎯 — S1 候选')
    const nativeUnicode = await utils.sha256Hex(unicode)
    const portableUnicode = utils.sha256Portable(unicode)
    Object.defineProperty(crypto, 'subtle', {
      configurable: true, value: undefined,
    })
    return {
      checked, nativeUnicode, portableUnicode,
      missingSubtle: crypto.subtle === undefined,
      fallback: await utils.sha256Hex(unicode),
    }
  })
  expect(fingerprints.missingSubtle).toBe(true)
  for (const result of fingerprints.checked) {
    expect(result.portable).toBe(result.expected)
    expect(result.native).toBe(result.expected)
  }
  expect(fingerprints.portableUnicode).toBe(fingerprints.nativeUnicode)
  expect(fingerprints.fallback).toBe(fingerprints.nativeUnicode)
})

test('P0: pristine S1 startup, login entry and reload work with no crypto.subtle', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'subtle', { configurable: true, value: undefined })
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' }))
    .toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('学习数据安全检查未通过')).toHaveCount(0)
  await page.goto('/?s1-account=manage')
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' }))
    .toBeVisible({ timeout: 30_000 })
  await page.reload()
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' }))
    .toBeVisible({ timeout: 30_000 })
  await harness(page)
  const state = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const registry = await h.workspaceRegistryPort.read()
    const anon = await h.loadWorkspaceFromVault(h.ANONYMOUS)
    return { hashApiAbsent: crypto.subtle === undefined,
      generation: registry.generation, active: registry.active,
      vaultAvailable: Boolean(anon) }
  })
  expect(state).toEqual({
    hashApiAbsent: true, generation: 1,
    active: { kind: 'anonymous' }, vaultAvailable: true,
  })
})

test('P0: native-created V4 vault fingerprint remains readable without SubtleCrypto', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
  })
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'subtle', { configurable: true, value: undefined })
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '打开设置对话框' }))
    .toBeVisible({ timeout: 30_000 })
  await harness(page)
  const state = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const snapshot = await h.loadWorkspaceFromVault(h.ANONYMOUS)
    return {
      cryptoAbsent: crypto.subtle === undefined,
      records: await h.db.wordRecords.count(),
      snapshot: Boolean(snapshot),
      registry: (await h.workspaceRegistryPort.read()).generation,
    }
  })
  expect(state).toEqual({
    cryptoAbsent: true, records: 1, snapshot: true, registry: 1,
  })
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
