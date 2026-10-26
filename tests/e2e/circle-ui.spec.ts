import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const OWNER = 'owner-abc123'
const FRIEND = 'friend-def456'
const ID = 'a'.repeat(24)
const CODE = 'QC3-' + ID + '-' + 'b'.repeat(32)
const days = () => {
  const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  return Array.from({ length: 7 }, (_, i) => new Date(Date.parse(day + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10))
}
async function seed(page: Page, { expired = false } = {}) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
  await page.evaluate(async ({ owner, expired }) => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'circle-fixture-token', expiresAt: Math.floor(Date.now() / 1000) + (expired ? -10 : 3600),
      user: { userId: owner, username: '小禾', createdAt: '2026-10-01' },
    }))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: owner })
  }, { owner: OWNER, expired })
}
async function mockCircle(page: Page, initial = true) {
  const model = {
    exists: initial, joined: initial, owner: OWNER, name: '每天十分钟', friend: true,
    calls: [] as { path: string; method: string; body: any }[],
    creates: [] as any[], unauthorized: false, loseCreate: false, delayLike: false, serverPhrase: false, rejectCreate: false, takenPhrase: false, inviteCode: CODE, inviteRevision: 'legacy',
    progress: new Map<string, any[]>([[days()[0], [{ authorUserId: FRIEND, day: days()[0], completed: true, newWords: 6 }]],
      [days()[1], [{ authorUserId: FRIEND, day: days()[1], completed: true, newWords: 2 }]]]),
    likes: new Map<string, number>(),
  }
  // All API traffic is isolated. No request reaches a real account or Blob service.
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/circle/v2', '')
    if (!new URL(request.url()).pathname.startsWith('/api/circle/v2')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false,"error":"not_found"}' })
      return
    }
    const body = request.postData() ? request.postDataJSON() : undefined
    model.calls.push({ path, method: request.method(), body })
    const send = (result: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: true, result }) })
    if (model.unauthorized) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false,"error":"session_revoked"}' })
      return
    }
    expect(request.headers().authorization).toBe('Bearer circle-fixture-token')
    if (path === '/mine') {
      await send({ circles: model.exists && model.joined ? [{ circleId: ID, name: model.name, role: model.owner === OWNER ? 'owner' : 'member' }] : [] })
    } else if (!path && request.method() === 'POST') {
      if (model.takenPhrase) {
        await route.fulfill({status:409,contentType:'application/json',body:'{"ok":false,"error":"circle_passphrase_taken"}'});return
      }
      if (model.rejectCreate) {
        model.creates.push(body)
        await new Promise(resolve => setTimeout(resolve, 300))
        await route.fulfill({status: 500, contentType: 'application/json', body: '{"ok":false,"error":"circle_internal_error"}'})
        return
      }
      model.serverPhrase = Boolean(body.passphrase); model.inviteCode = body.passphrase || CODE; model.inviteRevision = body.passphrase ? body.operationId : 'legacy'
      model.creates.push(body); model.exists = true; model.joined = true; model.name = body.name; model.owner = OWNER
      if (model.loseCreate) { model.loseCreate = false; await route.abort('failed'); return }
      await send({ circleId: ID, inviteCode: model.inviteCode, inviteRevision: model.inviteRevision, schemaVersion: 3 }, 202)
    } else if (path === '/join') {
      if (body.inviteCode !== model.inviteCode) {
        await route.fulfill({status:404,contentType:'application/json',body:'{"ok":false,"error":"invalid_invite"}'});return
      }
      model.exists = true; model.joined = true; model.owner = FRIEND
      await send({ circleId: ID, inviteRevision: model.inviteRevision }, 202)
    } else if ((path === '/' + ID || path.includes('/days/')) && request.method() === 'GET') {
      if (!model.exists || !model.joined) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"not_circle_member"}' }); return
      }
      const requestedDay=path.includes('/days/')?path.split('/').pop()!:days()[0]
      await send({ schemaVersion: 3, circleId: ID, day: requestedDay,
        ...(model.owner===OWNER && model.serverPhrase?{ownerInviteCode:model.inviteCode}:{}),
        meta: { name: model.name, ownerUserId: model.owner, softMemberLimit: 50, inviteMode: model.inviteRevision === 'legacy' ? 'legacy' : 'custom', inviteRevision: model.inviteRevision },
        members: [{ userId: OWNER, role: model.owner === OWNER ? 'owner' : 'member' },
          ...(model.friend ? [{ userId: FRIEND, role: model.owner === FRIEND ? 'owner' : 'member' }] : [])],
        progress: model.progress.get(requestedDay) || [], reactionCounts: [{ authorUserId: FRIEND, day: requestedDay, count: model.likes.get(requestedDay) || 0 }],
      })
    } else if (path.includes('/days/')) {
      const day = path.split('/').pop()!
      await send({ circleId: ID, day, progress: model.progress.get(day) || [],
        reactionCounts: [{ authorUserId: FRIEND, day, count: model.likes.get(day) || 0 }] })
    } else if (path.includes('/progress/') && request.method() === 'POST') {
      const day = path.split('/').pop()!
      const previous = model.progress.get(day) || []
      model.progress.set(day, [...previous.filter((p) => p.authorUserId !== OWNER),
        { authorUserId: OWNER, day, completed: body.completed, newWords: body.newWords }])
      await send({ circleId: ID }, 202)
    } else if (path.endsWith('/claps')) {
      if (model.delayLike) await new Promise((resolve) => setTimeout(resolve, 180))
      model.likes.set(body.day, 1)
      await send({ circleId: ID }, 202)
    } else if (path.endsWith('/invite')) {
      model.serverPhrase = true; model.inviteCode = body.passphrase; model.inviteRevision = 'rotated-fixture'
      await send({circleId: ID, inviteCode: model.inviteCode, inviteRevision: model.inviteRevision},202)
    } else if (path.endsWith('/remove')) {
      model.friend = false
      for (const [day, progress] of model.progress) model.progress.set(day, progress.filter((p) => p.authorUserId !== FRIEND))
      await send({ circleId: ID }, 202)
    } else if (path.endsWith('/close') || path.endsWith('/me')) {
      model.joined = false
      if (path.endsWith('/close')) model.exists = false
      await send({ circleId: ID }, 202)
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false,"error":"not_found"}' })
    }
  })
  return model
}
async function learningSnapshot(page: Page) {
  return page.evaluate("(async () => { const { db } = await import('/src/utils/db/core.ts'); return JSON.stringify(await Promise.all([db.wordRecords.toArray(), db.reviewRecords.toArray(), db.reviewWordStates.toArray()])); })()")
}

test('PC entry replaces only Learn ErrorBook, remains disabled while logged out, footer unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  let circleCalls = 0
  await page.route('**/api/circle/**', async (route) => { circleCalls++; await route.abort() })
  await page.goto('/learn')
  await expect(page.locator('[data-circle-entry]')).toBeDisabled({ timeout: 30000 })
  await expect(page.locator('[data-toolbar-row="icons"] [data-circle-entry]')).toHaveCount(1)
  await expect(page.locator('button[aria-label="微信社群暂未开放"]')).toBeDisabled()
  await expect(page.getByRole('button', { name: '错题本（Learn 模式禁用）' })).toHaveCount(0)
  await page.goto('/typing')
  await expect(page.getByRole('button', { name: '查看错题本' })).toBeEnabled()
  await expect(page.locator('[data-circle-entry]')).toHaveCount(0)
  await page.goto('/circles')
  await expect(page.getByRole('button', { name: '去登录', exact: true })).toBeVisible()
  expect(circleCalls).toBe(0)
})

test('PC overlay keeps learning mounted and records unchanged; seven days and single-flight likes work', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await seed(page)
  const model = await mockCircle(page)
  model.delayLike = true
  await page.goto('/learn')
  await expect(page.locator('[data-circle-entry]')).toBeEnabled({ timeout: 30000 })
  await page.evaluate(() => { (window as any).__circleHeader = document.querySelector('header') })
  const before = await learningSnapshot(page)
  await page.locator('[data-circle-entry]').click()
  await expect(page.locator('[data-navigation-dialog="circles"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: '每天十分钟', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '鼓励 同学 def456', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(page.getByRole('button', { name: '已点赞 同学 def456' })).toBeDisabled()
  expect(model.calls.filter((c) => c.path.endsWith('/claps')).length).toBe(1)
  await page.getByRole('button', { name: days()[1], exact: true }).click()
  await expect(page.getByText('已打卡 · 新学 2 词', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '提交打卡', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: days()[0] + ' 今天', exact: true }).click()
  await expect(page.getByText('已打卡 · 新学 6 词', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('circle-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)
  expect(await page.evaluate(() => (window as any).__circleHeader === document.querySelector('header'))).toBe(true)
  expect(await learningSnapshot(page)).toBe(before)
})

test('phone menu, creation, saved invitation, check-in, 320px and dark mode', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page)
  const model = await mockCircle(page, false)
  await page.goto('/mobile')
  await expect(page.getByRole('button', { name: '打开圈子', exact: true })).toBeEnabled({ timeout: 30000 })
  await page.getByRole('button', { name: '打开圈子', exact: true }).click()
  await expect(page).toHaveURL(/\/mobile\/circles$/)
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await page.getByLabel('圈子名称', { exact: true }).fill('晨间十分钟')
  await page.getByLabel('入圈口令', {exact:true}).fill('每天学 English')
  await page.getByRole('button', { name: '创建圈子', exact: true }).click()
  await expect(page.getByRole('heading', { name: '晨间十分钟', exact: true })).toBeVisible()
  expect(model.creates).toHaveLength(1)
  await page.getByText('邀请同学', { exact: true }).click()
  await expect(page.getByLabel('分享口令', { exact: true })).toHaveValue(model.inviteCode)
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__copiedCircle = text } } }))
  await page.getByRole('button', { name: '复制口令', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__copiedCircle)).toBe(model.inviteCode)
  await page.getByLabel('今天新学词数', { exact: true }).fill('12')
  await page.getByRole('button', { name: '提交打卡', exact: true }).click()
  await expect(page.getByText('已打卡 · 新学 12 词', { exact: true })).toBeVisible()
  expect(model.calls.filter((c) => c.path.includes('/progress/') && c.method === 'POST')).toHaveLength(1)
  await page.screenshot({ path: testInfo.outputPath('circle-mobile-light.png'), fullPage: true })
  await page.reload()
  await page.getByText('邀请同学', { exact: true }).click()
  await expect(page.getByLabel('分享口令', { exact: true })).toHaveValue(model.inviteCode)
  await page.setViewportSize({ width: 320, height: 720 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: testInfo.outputPath('circle-mobile-dark-320.png'), fullPage: true })
  await page.getByRole('link', { name: '返回首页' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
})

test('unknown creation is not auto-retried and reload reuses exact saved input; joining and leaving are direct', async ({ page }) => {
  await seed(page)
  const model = await mockCircle(page, false)
  model.loseCreate = true
  await page.goto('/circles')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await page.getByLabel('圈子名称', { exact: true }).fill('原信息创建')
  await page.getByLabel('入圈口令', {exact:true}).fill('每天学 English')
  await page.getByRole('button', { name: '创建圈子', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('操作结果还未确认')
  expect(model.creates).toHaveLength(1)
  await page.reload()
  await expect(page.getByRole('heading', { name: '原信息创建', exact: true })).toBeVisible()
  expect(model.creates).toHaveLength(1)
  await page.getByRole('button', { name: '继续创建', exact: true }).click()
  await expect(page.locator('.circle-notice')).toContainText('圈子已创建')
  expect(model.creates).toHaveLength(2)
  expect(model.creates[1]).toEqual(model.creates[0])
  // A separate circle joined by invitation exercises non-owner exit.
  model.exists = true; model.joined = false; model.owner = FRIEND
  await page.reload()
  await page.getByRole('button', { name: '口令加入', exact: true }).click()
  await page.getByLabel('圈子口令', { exact: true }).fill(model.inviteCode)
  await page.getByRole('button', { name: '加入圈子', exact: true }).click()
  await expect(page.locator('.circle-notice')).toContainText('已加入圈子')
  await page.getByText('离开圈子', { exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '退出圈子', exact: true }).click()
  await expect(page.locator('.circle-notice')).toContainText('已退出圈子')
  expect(model.calls.filter((c) => c.method === 'DELETE' && c.path.endsWith('/me'))).toHaveLength(1)
  expect(model.calls.filter((c) => c.path.endsWith('/close'))).toHaveLength(0)
})

test('owner removal and closure confirm once; keyboard Escape closes without editing learning', async ({ page }) => {
  await seed(page)
  const model = await mockCircle(page)
  await page.goto('/circles')
  await expect(page.getByRole('heading', { name: '每天十分钟', exact: true })).toBeVisible()
  await page.getByText('圈子管理', { exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '移除', exact: true }).click()
  await expect(page.locator('.circle-notice')).toContainText('已移除')
  await expect(page.getByRole('button', { name: '鼓励 同学 def456' })).toHaveCount(0)
  // Refresh preserves the open management panel instead of unmounting it.
  await expect(page.locator('details.circle-manage')).toHaveAttribute('open', '')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '关闭圈子', exact: true }).click()
  await expect(page.locator('.circle-notice')).toContainText('圈子已关闭')
  expect(model.calls.filter((c) => c.path.endsWith('/remove'))).toHaveLength(1)
  expect(model.calls.filter((c) => c.path.endsWith('/close'))).toHaveLength(1)
  await page.getByRole('link', { name: '返回学习' }).click()
  await page.locator('[data-circle-entry]').click()
  await expect(page.locator('[data-navigation-dialog="circles"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/learn$/)
})

test('expired session and 401 are guarded without deleting auth or replaying writes', async ({ page }) => {
  await seed(page, { expired: true })
  const model = await mockCircle(page)
  await page.goto('/mobile/circles')
  await expect(page.getByRole('button', { name: '去登录', exact: true })).toBeVisible()
  expect(model.calls).toHaveLength(0)
  expect(await page.evaluate(() => localStorage.getItem('qwerty.cloudAuth.v1'))).not.toBeNull()
  // Restore the same test account's validity in the isolated context.
  await page.evaluate(() => {
    const key = 'qwerty.cloudAuth.v1'
    const auth = JSON.parse(localStorage.getItem(key)!)
    auth.expiresAt = Math.floor(Date.now() / 1000) + 3600
    localStorage.setItem(key, JSON.stringify(auth))
    window.dispatchEvent(new StorageEvent('storage', { key }))
  })
  await expect(page.getByRole('heading', { name: '每天十分钟', exact: true })).toBeVisible()
  model.unauthorized = true
  await page.getByRole('button', { name: '提交打卡', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新登录', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '每天十分钟', exact: true })).toHaveCount(0)
  expect(model.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1')!).token)).toBe('circle-fixture-token')
})

test('changing account during a delayed read discards private results', async ({ page }) => {
  await seed(page)
  await mockCircle(page)
  let release: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => { release = resolve })
  let requested = false
  await page.route('**/api/circle/v2/' + ID, async (route) => {
    requested = true
    await waiting
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, result: { schemaVersion: 3, circleId: ID, day: days()[0],
        meta: { name: '不应显示的旧圈子', ownerUserId: OWNER, softMemberLimit: 50 }, members: [], progress: [], reactionCounts: [] },
    }) }) } catch { /* Aborted by session cleanup. */ }
  })
  await page.goto('/circles')
  await expect.poll(() => requested).toBe(true)
  await page.evaluate(() => {
    localStorage.removeItem('qwerty.cloudAuth.v1')
    window.dispatchEvent(new StorageEvent('storage', { key: 'qwerty.cloudAuth.v1' }))
  })
  await expect(page.getByRole('button', { name: '去登录', exact: true })).toBeVisible()
  release()
  await expect(page.getByRole('heading', { name: '不应显示的旧圈子' })).toHaveCount(0)
})

test('storage failure stops creation before sending and legacy invitations are explained', async ({ page }) => {
  await seed(page)
  const model = await mockCircle(page, false)
  await page.goto('/circles')
  await page.getByRole('button', { name: '口令加入', exact: true }).click()
  await page.getByLabel('圈子口令', { exact: true }).fill(CODE.replace('QC3-', 'QC2-'))
  await page.getByRole('button', { name: '加入圈子', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('旧版圈子')
  expect(model.calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await page.getByLabel('圈子名称', { exact: true }).fill('存储不可用')
  await page.getByLabel('入圈口令', {exact:true}).fill('每天学 English')
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('qwerty.circle-ui.v1.')) throw new DOMException('Quota', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: '创建圈子', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('本机暂时无法保存')
  expect(model.creates).toHaveLength(0)
})


test('PC failed hh creation stays explicit, restores exact retry and fits a narrow dialog container', async ({page}, testInfo) => {
  await page.setViewportSize({width: 1440, height: 1000})
  await seed(page)
  const model = await mockCircle(page, false)
  model.rejectCreate = true
  await page.goto('/learn')
  await page.locator('[data-circle-entry]').click()
  await expect(page.getByRole('heading', {name: '创建或加入圈子'})).toBeVisible()
  await page.getByRole('button', {name: '创建', exact: true}).click()
  await page.getByLabel('圈子名称', {exact:true}).fill('hh')
  await page.getByLabel('入圈口令', {exact:true}).fill('每天学 English')
  await page.getByRole('button', {name: '创建圈子', exact:true}).click()
  await expect(page.getByRole('button', {name:'正在创建…', exact:true})).toBeDisabled()
  await expect(page.locator('.circle-form [role=alert]')).toContainText('服务暂时出错')
  expect(model.creates).toHaveLength(1)
  expect(await page.locator('.circle-main').isVisible()).toBe(false)
  await page.locator('.circle-ui').evaluate((el:HTMLElement)=>{el.style.width='420px'})
  expect(await page.locator('.circle-ui').evaluate((el)=>el.scrollWidth<=el.clientWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('circle-create-failure.png')})
  const first = model.creates[0]
  await page.reload()
  await expect(page.getByLabel('圈子名称', {exact:true})).toHaveValue('hh')
  await expect(page.getByText('上次创建尚未确认。继续创建会核对同一个圈子，不会重复创建。')).toBeVisible()
  model.rejectCreate=false
  await page.getByRole('button', {name:'继续创建',exact:true}).click()
  await expect(page.getByRole('heading', {name:'hh',exact:true})).toBeVisible()
  expect(model.creates[1]).toEqual(first)
})


test('owner sets and changes Chinese/English passphrase, server invitation replaces stale local hints, and join uses phrase only', async ({page}) => {
  await seed(page)
  const model=await mockCircle(page,false)
  model.takenPhrase=true
  await page.goto('/circles')
  await page.getByRole('button',{name:'创建',exact:true}).click()
  await page.getByLabel('圈子名称',{exact:true}).fill('英文学习')
  await page.getByLabel('入圈口令',{exact:true}).fill('Taken 已占用')
  await page.getByRole('button',{name:'创建圈子',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('已被其他圈子使用')
  await expect(page.getByLabel('入圈口令',{exact:true})).toBeEditable()
  model.takenPhrase=false
  await page.getByLabel('入圈口令',{exact:true}).fill('每天学 English')
  await page.getByRole('button',{name:'创建圈子',exact:true}).click()
  await expect(page.getByRole('heading',{name:'英文学习',exact:true})).toBeVisible()
  await page.getByText('圈子管理',{exact:true}).click()
  await page.getByLabel('新入圈口令',{exact:true}).fill('共同学习 ABC')
  page.once('dialog',d=>d.accept())
  await page.getByRole('button',{name:'保存口令',exact:true}).click()
  await expect(page.locator('.circle-notice')).toContainText('旧口令无法再加入')
  await page.getByText('邀请同学',{exact:true}).click()
  await expect(page.getByLabel('分享口令',{exact:true})).toHaveValue('共同学习 ABC')
  model.inviteCode='另一个设备修改';model.inviteRevision='changed-elsewhere'
  await page.getByRole('button',{name:'刷新圈子',exact:true}).click()
  await expect(page.getByLabel('当前口令',{exact:true})).toHaveValue('另一个设备修改')
  model.joined=false;model.owner=FRIEND
  await page.reload()
  await page.getByRole('button',{name:'口令加入',exact:true}).click()
  await page.getByLabel('圈子口令',{exact:true}).fill('共同学习 ABC')
  await page.getByRole('button',{name:'加入圈子',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('口令不正确')
  await page.getByLabel('圈子口令',{exact:true}).fill('另一个设备修改')
  await page.getByRole('button',{name:'加入圈子',exact:true}).click()
  await expect(page.locator('.circle-notice')).toContainText('已加入圈子')
  await expect(page.getByLabel('新入圈口令',{exact:true})).toHaveCount(0)
})


test('owner current phrase is immediately visible without local hints; switching days sends one read and likes do not reload mine', async ({page}) => {
  await seed(page)
  const model=await mockCircle(page)
  model.serverPhrase=true;model.inviteCode='跨设备中文 English';model.inviteRevision='server-1'
  await page.goto('/circles')
  await expect(page.getByLabel('当前口令',{exact:true})).toHaveValue(model.inviteCode)
  const before=model.calls.length
  await page.getByRole('button',{name:days()[1],exact:true}).click()
  await expect(page.getByText('已打卡 · 新学 2 词',{exact:true})).toBeVisible()
  expect(model.calls.slice(before).map(c=>c.path)).toEqual(['/'+ID+'/days/'+days()[1]])
  const mineCount=model.calls.filter(c=>c.path==='/mine').length
  await page.getByRole('button',{name:'鼓励 同学 def456',exact:true}).click()
  await expect(page.getByRole('button',{name:'已点赞 同学 def456'})).toBeDisabled()
  expect(model.calls.filter(c=>c.path==='/mine')).toHaveLength(mineCount)
  model.owner=FRIEND
  await page.reload()
  await expect(page.getByRole('heading',{name:model.name,exact:true})).toBeVisible()
  await expect(page.getByLabel('当前口令',{exact:true})).toHaveCount(0)
})
