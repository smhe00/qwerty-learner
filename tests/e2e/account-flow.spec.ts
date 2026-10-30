import { expect, test } from '@playwright/test'
import { prepareVisibleUI, auditVisibleUI } from './ui-visible-audit'
import { pagesUI, uiPath } from './ui-test-path'
import { readGuideLearningState } from './user-guide-state'

test.beforeEach(async ({ page }, info) => prepareVisibleUI(page, info.project.name.endsWith('dark')))

test('one-submit account flow returns to its original page and preserves both record owners', async ({ page }, info) => {
  const desktop = info.project.name.startsWith('desktop')
  const target = desktop ? '/typing' : '/mobile/data'
  const entry = () => desktop ? page.getByRole('button', { name: '账号：登录或注册', exact: true }) : page.getByRole('button', { name: '管理账号', exact: true })
  const ready = () => desktop ? page.getByRole('button', { name: '打开设置对话框' }) : page.locator('[data-mobile-data]')
  let logins = 0, allowLogout = false
  const dialogs: string[] = [], api: string[] = []
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.method() + ' ' + new URL(r.url()).pathname) })
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); if (allowLogout) await dialog.accept(); else await dialog.dismiss() })
  if (!pagesUI) {
    await page.route('**/api/auth/login', route => {
      logins++
      return route.fulfill({ json: { ok: true, user: { userId: 'account-flow-owner', username: 'flow-user' }, token: 'flow-fixture-token', expiresAt: Math.floor(Date.now() / 1000) + 3600 } })
    })
    await page.route('**/api/auth/me', route => route.fulfill({ json: { ok: true, user: { userId: 'account-flow-owner', username: 'flow-user' } } }))
  }
  await page.goto(uiPath(target))
  await expect(ready()).toBeVisible({ timeout: 30_000 })
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('RecordDB'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('wordRecords', 'readwrite')
      tx.objectStore('wordRecords').put({ id: 9981, word: 'flow-retained-word', dict: 'cet4', chapter: 0, timeStamp: 1800000000, timing: [100], wrongCount: 0, mistakes: {}, sourceMode: 'learn' })
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    db.close()
    // Seed explicit saved navigation rather than comparing absent defaults
    // with the V4 restore adapter's canonical persisted representation.
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', '0')
    localStorage.setItem('reviewModeInfo', JSON.stringify({ isReviewMode: false }))
  })
  await page.reload()
  await expect(ready()).toBeVisible({ timeout: 30_000 })
  const before = await readGuideLearningState(page)
  await entry().click()
  await expect(page.locator('[data-account]')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /带入本机学习记录/ })).toBeHidden()
  await page.getByLabel('用户名', { exact: true }).fill('flow-user')
  await page.getByLabel('账户密码', { exact: true }).fill('synthetic-fixture')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeInViewport({ ratio: 1 })
  await auditVisibleUI(page, info, 'account-flow-login')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(ready()).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(new RegExp(uiPath(target) + '$'))
  expect(logins).toBe(0)
  expect(await readGuideLearningState(page)).toBe(before)
  await entry().click()
  if (pagesUI) {
    await page.getByRole('tab', { name: '注册', exact: true }).click()
    await page.getByRole('checkbox', { name: /带入本机学习记录/ }).uncheck()
    await auditVisibleUI(page, info, 'account-flow-register-choice')
    await page.getByLabel('用户名', { exact: true }).fill('flow-preview')
    await page.getByLabel('账户密码', { exact: true }).fill('synthetic-fixture')
    await page.getByLabel('注册密码确认', { exact: true }).fill('synthetic-fixture')
    await page.getByRole('button', { name: '注册并登录' }).click()
    await expect(page.getByRole('status')).toContainText('此预览不会创建账号')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(ready()).toBeVisible()
    expect(await readGuideLearningState(page)).toBe(before)
    expect(api).toEqual([])
  } else {
    await page.getByLabel('用户名', { exact: true }).fill('flow-user')
    await page.getByLabel('账户密码', { exact: true }).fill('synthetic-fixture')
    await page.getByLabel('账户密码', { exact: true }).press('Enter')
    await expect(ready()).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(new RegExp(uiPath(target) + '$'))
    expect(logins).toBe(1)
    expect(dialogs).toEqual([])
    expect(JSON.parse(await readGuideLearningState(page)).rows.find(([name]: [string]) => name === 'wordRecords')[1]).toEqual([])
    if (desktop) await page.locator('[data-account-entry]').click()
    else await entry().click()
    await expect(page.getByRole('heading', { name: '我的账号' })).toBeVisible()
    await expect(page.getByRole('button', { name: '重新验证登录', exact: true })).toBeHidden()
    allowLogout = true
    await page.getByRole('button', { name: '安全退出登录' }).click()
    await expect(ready()).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(new RegExp(uiPath(target) + '$'))
    expect(dialogs).toHaveLength(1)
    // Dismiss only the existing informative logout result, then compare data.
    const information = page.getByRole('button', { name: '知道了', exact: true })
    if (await information.isVisible()) await information.click()
    expect(await readGuideLearningState(page)).toBe(before)
  }
  await auditVisibleUI(page, info, 'account-flow-returned')
})

test('accepted credentials with failed workspace preparation do not retry server login', async ({ page }, info) => {
  test.skip(pagesUI, 'Pages never authenticates or switches a workspace.')
  let calls = 0
  await page.route('**/api/auth/login', route => { calls++; return route.fulfill({ json: { ok: true, user: { userId: 'prepare-owner', username: 'flow-user' }, token: 'synthetic', expiresAt: Math.floor(Date.now() / 1000) + 3600 } }) })
  await page.goto(uiPath('/mobile/account'))
  await expect(page.locator('[data-mobile-account]')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    ;(window as any).__restoreAccountWrite = () => { Storage.prototype.setItem = original }
    Storage.prototype.setItem = function (key, value) {
      if (key === 'qwerty.s1.auth-transition.v1') throw new DOMException('account preparation fixture', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await page.getByLabel('用户名', { exact: true }).fill('flow-user')
  await page.getByLabel('账户密码', { exact: true }).fill('synthetic-fixture')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '学习进度尚未就绪' })).toBeVisible()
  await expect(page.getByText('账号验证已通过。请重新检查，继续完成学习数据准备。', { exact: true })).toBeVisible()
  await expect(page.getByLabel('账户密码', { exact: true })).toBeHidden()
  await auditVisibleUI(page, info, 'account-flow-preparation-error')
  await page.evaluate(() => (window as any).__restoreAccountWrite())
  await page.getByRole('button', { name: '重新检查', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' })).toBeVisible()
  expect(calls).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('qwerty.cloudAuth.v1'))).toBeNull()
})
