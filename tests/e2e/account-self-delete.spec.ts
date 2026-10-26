import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

const key = 'qwerty.account-self-delete.v1.delete-owner'
const account = { kind: 'account', accountId: 'delete-owner' }
async function harness(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
}
async function seed(page: Page, role = 'ordinary') {
  await harness(page)
  return page.evaluate(
    async ({ role, account }) => {
      const h = (window as any).__backupHarness
      await h.seed()
      const anonymous = await h.captureWorkingWorkspaceV4(h.ANONYMOUS)
      await h.saveWorkspaceToVault(h.ANONYMOUS, anonymous)
      if (role !== 'anonymous') {
        localStorage.setItem(
          'qwerty.cloudAuth.v1',
          JSON.stringify({
            token: 'delete-fixture',
            expiresAt: Math.floor(Date.now() / 1000) + (role === 'expired' ? -60 : 3600),
            user: { userId: 'delete-owner', username: 'delete-user' },
          }),
        )
        await h.db.wordRecords.toCollection().modify({ word: 'self-delete-account-record' })
      }
      await h.initializeLegacyWorkspace(role === 'anonymous' ? h.ANONYMOUS : account)
      return {
        anonymous,
        before: await h.captureWorkingWorkspaceV4(role === 'anonymous' ? h.ANONYMOUS : account),
        auth: localStorage.getItem('qwerty.cloudAuth.v1'),
      }
    },
    { role, account },
  )
}
async function inspect(page: Page) {
  await harness(page)
  return page.evaluate(async (account) => {
    const h = (window as any).__backupHarness
    return {
      registry: await h.workspaceRegistryPort.read(),
      auth: localStorage.getItem('qwerty.cloudAuth.v1'),
      saved: await h.loadWorkspaceFromVault(account),
      working: await h.captureWorkingWorkspaceV4((await h.workspaceRegistryPort.read()).active),
    }
  }, account)
}
async function form(page: Page) {
  await expect(page.locator('[data-account]')).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: '删除我的云端账号', exact: true }).click()
  await page.getByLabel('当前账号密码', { exact: true }).fill('current-password')
  await page.getByRole('checkbox', { name: '我已保存需要的备份' }).check()
}
async function submit(page: Page, accept = true) {
  page.once('dialog', (dialog) => (accept ? dialog.accept() : dialog.dismiss()))
  await page.getByRole('button', { name: '永久删除云端账号', exact: true }).click()
}

for (const mobile of [false, true]) {
  const url = mobile ? '/mobile/account' : '/?s1-account=manage'
  test.describe(mobile ? 'mobile self deletion' : 'desktop self deletion', () => {
    test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 } })
    for (const fallback of [false, true]) {
      test(
        (fallback ? 'fallback' : 'native') + ' deletes only cloud identity and preserves both local workspaces',
        async ({ page, context }, testInfo) => {
          if (fallback)
            await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }))
          const before = await seed(page)
          if (mobile && fallback) {
            await page.setViewportSize({ width: 320, height: 740 })
            await page.evaluate(() => localStorage.setItem('isOpenDarkModeAtom', 'true'))
          }
          let access = 0
          const calls: unknown[] = []
          let releaseDelete: () => void = () => undefined
          const deletionReply = new Promise<void>((resolve) => {
            releaseDelete = resolve
          })
          await page.route('**/api/**', async (route) => {
            if (new URL(route.request().url()).pathname === '/api/admin/access') {
              access++
              return route.fulfill({ json: { administrator: false } })
            }
            if (route.request().method() === 'DELETE') {
              calls.push({
                method: route.request().method(),
                body: route.request().postDataJSON(),
                authorization: route.request().headers().authorization,
              })
              await deletionReply
              return route.fulfill({ json: { ok: true, deleted: { accountDeleted: true } } })
            }
            return route.fulfill({ json: { ok: true } })
          })
          await page.goto(url)
          await form(page)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
          await page.locator('[data-self-delete]').screenshot({ path: testInfo.outputPath('delete-controls.png') })
          const downloadPromise = page.waitForEvent('download')
          await page.getByRole('button', { name: '下载本机学习备份', exact: true }).click()
          const download = await downloadPromise
          const file = await download.path()
          if (!file) throw new Error('Backup download missing')
          const snapshot = JSON.parse(gunzipSync(await readFile(file)).toString('utf-8'))
          expect(snapshot.workspaceData).toEqual(before.before.workspaceData)
          expect(calls).toHaveLength(0)
          const contender = await context.newPage()
          await harness(contender)
          expect(
            await contender.evaluate(async () => {
              try {
                const lease = await (window as any).__backupHarness.acquireWorkspaceWriterLease()
                lease.release()
                return 'stolen'
              } catch {
                return 'blocked'
              }
            }),
          ).toBe('blocked')
          await contender.close()
          await expect(page.getByRole('button', { name: '永久删除云端账号', exact: true })).toBeEnabled()
          await submit(page)
          await expect.poll(() => calls.length).toBe(1)
          await expect(page.getByRole('button', { name: '永久删除云端账号', exact: true })).toBeDisabled()
          await page.locator('#account-self-delete-form').dispatchEvent('submit')
          expect(calls).toHaveLength(1)
          releaseDelete()
          await expect(page).toHaveURL(mobile ? /\/mobile$/ : /\/$/)
          expect(calls).toEqual([
            { method: 'DELETE', body: { currentPassword: 'current-password' }, authorization: 'Bearer delete-fixture' },
          ])
          expect(access).toBe(2)
          expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), key)) || '{}').state).toBe('confirmed')
          const after = await inspect(page)
          expect(after.auth).toBeNull()
          expect(after.registry.active).toEqual({ kind: 'anonymous' })
          expect(after.registry.pending).toBeNull()
          expect(after.saved.workspaceData).toEqual(before.before.workspaceData)
          expect(after.working.workspaceData).toEqual(before.anonymous.workspaceData)
        },
      )
    }
    for (const role of ['administrator', 'failed', 'malformed', 'expired', 'anonymous']) {
      test(role + ' never receives a deletion entry', async ({ page }) => {
        await seed(page, role)
        let requests = 0
        await page.route('**/api/**', (route) => {
          requests++
          return route.fulfill({ status: role === 'failed' ? 503 : 200, json: { administrator: role === 'malformed' ? 'false' : true } })
        })
        await page.goto(url)
        await expect(page.locator('[data-account]')).toBeVisible()
        if (!['expired', 'anonymous'].includes(role)) await expect.poll(() => requests).toBe(1)
        await expect(page.getByRole('button', { name: '删除我的云端账号', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: '永久删除云端账号', exact: true })).toHaveCount(0)
        if (['expired', 'anonymous'].includes(role)) expect(requests).toBe(0)
      })
    }
    test('consent, cancellation and wrong password do not change identity or learning data', async ({ page }) => {
      const before = await seed(page)
      let deletes = 0
      await page.route('**/api/admin/access', (route) => route.fulfill({ json: { administrator: false } }))
      await page.route('**/api/auth/account', (route) => {
        deletes++
        return route.fulfill({ status: 401, json: { error: 'invalid_credentials' } })
      })
      await page.goto(url)
      await page.getByRole('button', { name: '删除我的云端账号', exact: true }).click()
      await expect(page.getByRole('button', { name: '永久删除云端账号', exact: true })).toBeDisabled()
      await page.getByLabel('当前账号密码', { exact: true }).fill('current-password')
      await page.getByRole('checkbox', { name: '我已保存需要的备份' }).check()
      await submit(page, false)
      expect(deletes).toBe(0)
      await submit(page)
      await expect(page.getByRole('status')).toContainText('当前密码不正确')
      expect(deletes).toBe(1)
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull()
      const after = await inspect(page)
      expect(after.auth).toBe(before.auth)
      expect(after.working.workspaceData).toEqual(before.before.workspaceData)
      expect(after.registry.active).toEqual(account)
    })
  })
}

for (const fault of ['network', 'server', 'malformed', 'unconfirmed']) {
  test(fault + ' ambiguous deletion is never replayed after reload', async ({ page }) => {
    const before = await seed(page)
    let deletes = 0
    await page.route('**/api/admin/access', (route) => route.fulfill({ json: { administrator: false } }))
    await page.route('**/api/auth/account', (route) => {
      deletes++
      if (fault === 'network') return route.abort()
      if (fault === 'server') return route.fulfill({ status: 500, json: { error: 'account_delete_failed' } })
      if (fault === 'malformed') return route.fulfill({ status: 200, body: 'not json' })
      return route.fulfill({ json: { ok: true, deleted: { accountDeleted: false } } })
    })
    await page.goto('/?s1-account=manage')
    await form(page)
    await submit(page)
    await expect(page.getByRole('status')).toContainText('删除结果尚未确认')
    await page.reload()
    await expect(page.locator('[data-self-delete]')).toContainText('删除结果尚未确认')
    await expect(page.getByRole('button', { name: '永久删除云端账号' })).toHaveCount(0)
    expect(deletes).toBe(1)
    const after = await inspect(page)
    expect(after.auth).toBe(before.auth)
    expect(after.working.workspaceData).toEqual(before.before.workspaceData)
    expect(after.saved.workspaceData).toEqual(before.before.workspaceData)
  })
}

test('fresh role check rejects an account promoted to administrator', async ({ page }) => {
  await seed(page)
  let checks = 0
  let deletes = 0
  await page.route('**/api/admin/access', (route) => route.fulfill({ json: { administrator: ++checks > 1 } }))
  await page.route('**/api/auth/account', (route) => {
    deletes++
    return route.fulfill({ json: {} })
  })
  await page.goto('/?s1-account=manage')
  await form(page)
  await submit(page)
  await expect(page.getByRole('status')).toContainText('未提交删除')
  await expect(page.getByRole('button', { name: '删除我的云端账号' })).toBeHidden()
  expect(deletes).toBe(0)
})

for (const fault of ['journal', 'backup', 'transition']) {
  test(fault + ' local failure retains records and never repeats a cloud deletion', async ({ page }) => {
    const before = await seed(page)
    let deletes = 0
    await page.route('**/api/admin/access', (route) => route.fulfill({ json: { administrator: false } }))
    await page.route('**/api/auth/account', (route) => {
      deletes++
      return route.fulfill({ json: { ok: true, deleted: { accountDeleted: true } } })
    })
    await page.goto('/?s1-account=manage')
    await form(page)
    await page.evaluate(
      ({ fault, key }) => {
        if (fault === 'backup') {
          const original = IDBDatabase.prototype.transaction
          IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
            if (this.name === 'QwertyPlusWorkspaceVaultV1' && args[1] === 'readwrite') throw new Error('Injected vault failure')
            return original.apply(this, args as any)
          } as any
        } else {
          const original = Storage.prototype.setItem
          Storage.prototype.setItem = function (k, value) {
            if (k === (fault === 'journal' ? key : 'qwerty.s1.auth-transition.v1')) throw new Error('Injected durable write failure')
            return original.call(this, k, value)
          }
        }
      },
      { fault, key },
    )
    await submit(page)
    await expect(page.getByRole('status')).toContainText(fault === 'transition' ? '本机退出尚未完成' : 'Injected')
    expect(deletes).toBe(fault === 'transition' ? 1 : 0)
    await page.reload()
    if (fault === 'transition') {
      await page.getByRole('button', { name: '完成本机安全退出' }).click()
      await expect(page).toHaveURL(/\/$/)
      expect(deletes).toBe(1)
    }
    const after = await inspect(page)
    if (fault !== 'transition') expect(after.auth).toBe(before.auth)
    else expect(after.auth).toBeNull()
    expect((fault === 'transition' ? after.saved : after.working).workspaceData).toEqual(before.before.workspaceData)
  })
}
