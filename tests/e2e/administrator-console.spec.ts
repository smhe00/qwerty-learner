import { inspectReturnedWorkspace, seedSealedLegacyAdministrator } from './administrator-workspace-fixture'
import { pagesUI, uiPath } from './ui-test-path'
import { auditVisibleUI, prepareVisibleUI } from './ui-visible-audit'
import { type Page, expect, test } from '@playwright/test'

const adminId = 'c'.repeat(32),
  studentId = 'a'.repeat(32)
const admin = {
  token: 'synthetic-admin-session',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  user: { userId: adminId, username: 'admin', role: 'administrator', createdAt: '2026-10-29T00:00:00Z' },
}
const student = {
  ...admin,
  token: 'synthetic-student-session',
  user: { ...admin.user, userId: studentId, username: 'student', role: undefined },
}
async function isolate(page: Page, legacy = false) {
  await page.addInitScript(
    ({ admin, student, legacy }) => {
      localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify(legacy ? admin : student))
      localStorage.setItem('admin-test-learning-sentinel', 'preserve-learning-data')
      ;(window as any).__adminDatabaseOpens = []
      const open = IDBFactory.prototype.open
      IDBFactory.prototype.open = function (...args) {
        ;(window as any).__adminDatabaseOpens.push(args[0])
        return open.apply(this, args)
      }
    },
    { admin, student, legacy },
  )
}
function api(page: Page) {
  const calls: { path: string; method: string; bearer?: string }[] = []
  const state = { revoked: false, overviewError: false, previewError: false, visitsError: false, sent: false, deletions: 0 }
  const item = { id: 'f'.repeat(64), owner: 'a-' + studentId, title: '手机上学习按钮遮挡', createdAt: Date.now() }
  const overview = {
    rows: [
      {
        id: studentId,
        username: 'student',
        createdAt: '2026-10-28T00:00:00Z',
        activeDays: [new Date().toISOString().slice(0, 10)],
        attempts: 16,
        recentAttempts: 12,
        testAccount: false,
        historyComplete: true,
        metadataAvailable: true,
      },
    ],
    nextCursor: null,
    asOf: new Date().toISOString(),
  }
  const ready = page.route('**/api/**', async (route) => {
    const r = route.request(),
      path = new URL(r.url()).pathname,
      bearer = r.headers().authorization
    calls.push({ path, method: r.method(), bearer })
    const reply = (value: object, status = 200) => route.fulfill({ status, json: { ok: status === 200, ...value } })
    if (path === '/api/auth/login') return reply(admin)
    if (state.revoked) return reply({ message: '登录失效' }, 401)
    if (path === '/api/auth/me') return reply({ user: bearer === 'Bearer ' + admin.token ? admin.user : student.user })
    if (path === '/api/admin/access') return reply({ administrator: bearer === 'Bearer ' + admin.token })
    if (path === '/api/admin/overview') return state.overviewError ? reply({ message: '统计暂不可用，请重试' }, 503) : reply(overview)
    if (path === '/api/admin/visits') return state.visitsError ? reply({}, 503) : reply({ today: 3, last7Days: 11 })
    if (path === '/api/admin/storage') return reply({ accounts: 2, objects: 12, reportedBytes: 0, sizeComplete: false })
    if (path === '/api/admin/idle') {
      if (r.method() === 'GET' && new URL(r.url()).searchParams.has('cursor') && state.previewError)
        return reply({ message: '下一页预览失败' }, 503)
      if (r.method() === 'POST') {
        state.deletions++
        expect(r.postDataJSON().cursor).toBe('')
      }
      return reply({
        executionEnabled: true,
        results: [{ userId: studentId, username: 'student', action: 'retain' }],
        nextCursor: 'b'.repeat(64),
      })
    }
    if (path === '/api/admin/logout') return reply({ revoked: true })
    if (path === '/api/feedback') return reply({ administrator: true, items: [item], cursor: '' })
    if (path.startsWith('/api/feedback/')) {
      if (r.method() === 'POST') {
        state.sent = true
        return reply(item)
      }
      return reply({
        ...item,
        text: '320px 手机宽度下，按钮被挡住了。',
        status: state.sent ? 'resolved' : 'waiting',
        messages: state.sent
          ? [{ id: 'reply', text: '已修复，请刷新页面。', role: 'admin', status: 'resolved', createdAt: Date.now() }]
          : [],
      })
    }
    return reply({ message: 'Unexpected API in administrator test: ' + path }, 503)
  })
  return { ready, calls, state }
}
async function untouched(page: Page, calls: { path: string }[], legacy = false) {
  expect(calls.filter((c) => /sync|maintenance|circle|event-batches/.test(c.path))).toEqual([])
  const state = await page.evaluate(() => ({
    opens: (window as any).__adminDatabaseOpens,
    auth: localStorage.getItem('qwerty.cloudAuth.v1'),
    learning: localStorage.getItem('admin-test-learning-sentinel'),
  }))
  expect(state.opens).toEqual([])
  expect(state.learning).toBe('preserve-learning-data')
  expect(state.auth).toBe(legacy ? JSON.stringify(admin) : JSON.stringify(student))
}
test.beforeEach(async ({ page }, info) => prepareVisibleUI(page, info.project.name.endsWith('dark')))

test('administrator login has an independent mobile and desktop entry', async ({ page }, info) => {
  await isolate(page)
  const network = api(page)
  await network.ready
  await page.goto(uiPath(info.project.name.startsWith('phone') ? '/mobile/admin' : '/admin'))
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
  await auditVisibleUI(page, info, 'administrator-login')
  await page.screenshot({ path: info.outputPath('administrator-login.png'), fullPage: true })
  if (pagesUI) {
    await page.getByLabel('管理员密码').fill('synthetic-password')
    await page.getByRole('button', { name: '进入管理控制台', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('预览站不执行管理员认证')
    await page.getByRole('button', { name: '查看管理界面示意' }).click()
    await expect(page.getByText('示例数据 · 不是真实使用统计。回复与维护操作不可执行。')).toBeVisible()
    for (const name of ['运营概览', '用户使用', '反馈回复', '系统维护']) {
      await page.getByRole('tab', { name, exact: true }).click()
      await auditVisibleUI(page, info, 'administrator-preview-' + name)
    }
    await expect(page.getByRole('button', { name: '读取存储用量' })).toBeDisabled()
    expect(network.calls).toEqual([])
  } else {
    await page.getByLabel('管理员密码').fill('synthetic-password')
    await page.getByRole('button', { name: '进入管理控制台', exact: true }).click()
    await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
    await expect(page.getByText('已核对普通账号', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
  }
  await untouched(page, network.calls)
  await page.getByRole('button', { name: '退出管理', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('qwerty.administrator.session.v1'))).toBeNull()
  await untouched(page, network.calls)
})

test('administrator operating, reply, maintenance and session failure states remain usable', async ({ page }, info) => {
  test.skip(pagesUI, 'Real management actions stay disabled in Pages; preview is covered separately.')
  await isolate(page)
  await page.addInitScript((admin) => sessionStorage.setItem('qwerty.administrator.session.v1', JSON.stringify(admin)), admin)
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/admin'))
  await expect(page.getByText('已核对普通账号', { exact: true })).toBeVisible()
  await auditVisibleUI(page, info, 'administrator-overview')
  await page.screenshot({ path: info.outputPath('administrator-overview.png'), fullPage: true })
  network.state.overviewError = true
  await page.getByRole('button', { name: '重新核对' }).click()
  await expect(page.getByRole('alert')).toContainText('统计暂不可用')
  await auditVisibleUI(page, info, 'administrator-statistics-error')
  network.state.overviewError = false
  await page.getByRole('button', { name: '重新核对' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('tab', { name: '用户使用', exact: true }).click()
  await auditVisibleUI(page, info, 'administrator-users')
  await page.getByRole('tab', { name: '反馈回复', exact: true }).click()
  await page.getByRole('button', { name: /手机上学习按钮遮挡/ }).click()
  await auditVisibleUI(page, info, 'administrator-feedback-thread')
  await page.getByLabel('继续交流').fill('已修复，请刷新页面。')
  await page.getByLabel('处理状态').selectOption('resolved')
  const send = page.getByRole('button', { name: '发送', exact: true })
  await send.scrollIntoViewIfNeeded()
  await expect(send).toBeInViewport()
  await auditVisibleUI(page, info, 'administrator-reply-action')
  await page.screenshot({ path: info.outputPath('administrator-reply-action.png'), fullPage: true })
  await send.click()
  await expect(page.getByText('已发送', { exact: true })).toBeVisible()
  expect(network.state.sent).toBe(true)
  await page.getByRole('button', { name: '返回反馈列表' }).click()
  await page.getByRole('tab', { name: '系统维护', exact: true }).click()
  await page.getByRole('button', { name: '读取存储用量' }).click()
  await expect(page.getByText(/容量未知/)).toBeVisible()
  await page.getByRole('button', { name: '预览清理名单' }).click()
  network.state.previewError = true
  await page.getByRole('button', { name: '预览下一页' }).click()
  await expect(page.getByRole('alert')).toContainText('下一页预览失败')
  await auditVisibleUI(page, info, 'administrator-maintenance')
  page.once('dialog', (d) => d.dismiss())
  await page.getByRole('button', { name: '确认清理本页到期账号' }).click()
  expect(network.state.deletions).toBe(0)
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '确认清理本页到期账号' }).click()
  await expect(page.getByRole('status')).toContainText('维护请求已完成')
  expect(network.state.deletions).toBe(1)
  await untouched(page, network.calls)
  network.state.revoked = true
  await page.getByRole('button', { name: '读取存储用量' }).click()
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('登录已失效')
  await auditVisibleUI(page, info, 'administrator-expired')
})

test('administrator legacy login redirects before learning startup and migrates only credentials', async ({ page }, info) => {
  test.skip(pagesUI, 'Pages never migrates authenticated credentials.')
  await isolate(page, true)
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/mobile'))
  await expect(page).toHaveURL(/\/mobile\/admin$/)
  await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
  await untouched(page, network.calls, true)
  await page.getByRole('button', { name: '退出管理' }).click()
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
})

test('administrator privilege cannot be granted by a forged local role', async ({ page }) => {
  test.skip(pagesUI, 'Pages has no authentication requests.')
  await isolate(page)
  await page.addInitScript(
    (student) =>
      sessionStorage.setItem(
        'qwerty.administrator.session.v1',
        JSON.stringify({ ...student, user: { ...student.user, username: 'admin', role: 'administrator' } }),
      ),
    student,
  )
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/admin'))
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('没有管理权限')
  expect(await page.evaluate(() => sessionStorage.getItem('qwerty.administrator.session.v1'))).toBeNull()
  expect(network.calls.every((c) => c.path === '/api/admin/access')).toBe(true)
  await untouched(page, network.calls)
})

test('administrator legacy SMHE credentials require an explicit admin login', async ({ page }) => {
  test.skip(pagesUI, 'Pages has no authenticated credential migration.')
  await isolate(page)
  await page.addInitScript(
    (admin) =>
      localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({ ...admin, user: { ...admin.user, username: 'smhe', role: undefined } })),
    admin,
  )
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/mobile'))
  await expect(page).toHaveURL(/\/mobile\/admin$/)
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('使用 admin 重新登录')
  expect(network.calls).toEqual([])
  expect(await page.evaluate(() => (window as any).__adminDatabaseOpens)).toEqual([])
  expect(await page.evaluate(() => sessionStorage.getItem('qwerty.administrator.session.v1'))).toBeNull()
})

test('administrator access ID reporting failure never blocks ordinary login or changes learning storage', async ({ page }, info) => {
  test.skip(pagesUI, 'Pages never reports visit statistics.')
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { configurable: true, value: false }))
  let sent = 0
  const ids = new Set<string>()
  await page.route('**/api/visits', async route => {
    sent++
    expect(route.request().method()).toBe('POST')
    expect(route.request().postData()).toBeNull()
    expect(route.request().headers().authorization).toBeUndefined()
    const id = route.request().headers().cookie?.match(/(?:^|;\s*)qp_uv=([a-f0-9]{32})(?=;|$)/)?.[1]
    expect(id).toBeTruthy()
    if (id) ids.add(id)
    await route.abort('failed')
  })
  await page.goto(uiPath('/mobile/account'))
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible()
  await expect.poll(() => sent).toBeGreaterThanOrEqual(1)
  const beforeReload = sent
  await page.reload()
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible()
  await expect.poll(() => sent).toBeGreaterThan(beforeReload)
  expect(ids.size).toBe(1)
  await page.getByLabel('用户名', { exact: true }).fill('ordinary-user')
  await page.getByLabel('账户密码', { exact: true }).fill('synthetic-password')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled()
  await expect(page.getByText('学习数据安全检查未通过', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /visit|analytics|metric|qp_uv/.test(key)))).toEqual([])
  await auditVisibleUI(page, info, 'ordinary-login-ignores-access-statistics-failure')
})

test('administrator access ID cards use daily totals and remain separate from learning', async ({ page }, info) => {
  await isolate(page)
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/admin'))
  if (pagesUI) await page.getByRole('button', { name: '查看管理界面示意', exact: true }).click()
  else {
    await page.getByLabel('管理员密码').fill('synthetic-password')
    await page.getByRole('button', { name: '进入管理控制台', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
  const cards = page.locator('[data-visitor-counts]')
  await expect(cards.getByRole('heading', { name: '今日访问 ID 数', exact: true })).toBeVisible()
  await expect(cards.getByRole('heading', { name: '近7日累计 ID 数', exact: true })).toBeVisible()
  await expect(cards.locator('strong')).toHaveText(pagesUI ? ['28', '96'] : ['3', '11'])
  await expect(page.getByText(/每个 ID 每日最多计 1 次，近 7 日按日相加/)).toBeVisible()
  await auditVisibleUI(page, info, 'administrator-daily-access-id-counts')
  await page.screenshot({ path: info.outputPath('administrator-daily-access-id-counts.png'), fullPage: true })
  expect(network.calls.filter(c => c.path === '/api/visits')).toEqual([])
  await untouched(page, network.calls)
})

test('administrator missing access statistics is silently unknown rather than zero', async ({ page }) => {
  test.skip(pagesUI, 'Pages uses explicit sample data and never requests private statistics.')
  await isolate(page)
  const network = api(page)
  network.state.visitsError = true
  await network.ready
  await page.goto(uiPath('/admin'))
  await page.getByLabel('管理员密码').fill('synthetic-password')
  await page.getByRole('button', { name: '进入管理控制台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
  await expect(page.locator('[data-visitor-counts] strong')).toHaveText(['—', '—'])
  await expect(page.getByText('已核对普通账号', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('tab', { name: '用户使用', exact: true }).click()
  await expect(page.getByRole('heading', { name: '用户使用', exact: true })).toBeVisible()
  await untouched(page, network.calls)
})

test('administrator sealed anonymous workspace roundtrip returns to ordinary login', async ({ page }) => {
  test.skip(pagesUI, 'Authenticated administrator return uses the cloud-enabled bundle.')
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/?s1-account=manage'))
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible()
  const before = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))
  await page.getByLabel('用户名', { exact: true }).fill('admin')
  await page.getByLabel('账户密码', { exact: true }).fill('synthetic-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '退出管理', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录管理控制台', exact: true })).toBeVisible()
  const after = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))
  const changes = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k])
  console.log('sealed admin roundtrip changed storage keys', changes)
  await page.getByRole('link', { name: '普通账号登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible()
  await expect(page.getByText('学习数据安全检查未通过', { exact: true })).toHaveCount(0)
  expect(network.calls.filter((c) => /\/api\/sync/.test(c.path))).toEqual([])
})

test('administrator old witness error survives refresh and has a complete recovery exit', async ({ page }, info) => {
  test.skip(pagesUI, 'Pages has no authenticated workspace recovery.')
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/?s1-account=manage'))
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible()
  await page.goto(uiPath('/admin'))
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
  const before = await seedSealedLegacyAdministrator(page, admin)
  await page.evaluate(() => localStorage.removeItem('qwerty.cloudAuth.v1'))
  // The reported browser has neither an admin session nor an admin-return URL.
  await page.goto(uiPath(info.project.name.startsWith('phone') ? '/mobile' : '/'))
  await expect(page.getByRole('heading', { name: '学习数据安全检查未通过' })).toBeVisible()
  await page.getByRole('button', { name: '重新检查', exact: true }).click()
  await expect(page.getByRole('heading', { name: '学习数据安全检查未通过' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('qwerty.s1.workspace-migrated.v1'))).toBe(before.witness)
  expect(await page.evaluate(() => localStorage.getItem('qwerty.cloudAuth.v1'))).toBeNull()
  expect(network.calls).toEqual([])
  const recover = page.getByRole('link', { name: '管理员切换恢复', exact: true })
  await expect(recover).toBeInViewport()
  await auditVisibleUI(page, info, 'administrator-old-error-recovery-exit')
  await page.screenshot({ path: info.outputPath('administrator-old-error-recovery-exit.png'), fullPage: true })
  await recover.click()
  await expect(page.getByRole('heading', { name: '登录管理控制台', exact: true })).toBeVisible()
  await page.getByLabel('管理员密码').fill('synthetic-password')
  await page.getByRole('button', { name: '进入管理控制台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '普通账号登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '恢复普通账号登录', exact: true })).toBeVisible()
  await page.getByLabel('我确认先保留完整本机副本，再恢复普通账号登录').check()
  await page.getByRole('button', { name: '保留数据并恢复普通登录' }).click()
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible({ timeout: 30000 })
  const after = await inspectReturnedWorkspace(page, adminId)
  expect(after.active).toEqual({ kind: 'anonymous' })
  expect(after.rows).toEqual([])
  expect(after.anonymousFingerprint).toBe(before.anonymousFingerprint)
  expect(after.adminSnapshot).toContain('preserved-admin-word')
  expect(after.rollbackCount).toBe(1)
  expect(after.auth).toBeNull()
  expect(after.management).toBeNull()
  expect(after.returnTicket).toBeNull()
  expect(network.calls.filter((c) => /\/api\/(sync|maintenance|circle)/.test(c.path))).toEqual([])
})

for (const [damaged, fallback] of [
  [false, false],
  [true, false],
  [true, true],
] as const) {
  test(
    'administrator sealed legacy return preserves both spaces: ' +
      (damaged ? 'deleted credential recovery' : 'healthy') +
      (fallback ? ' fallback writer' : ''),
    async ({ page }, info) => {
      test.skip(pagesUI, 'Pages never performs authenticated workspace transitions.')
      if (fallback) await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }))
      const network = api(page)
      await network.ready
      await page.goto(uiPath('/?s1-account=manage'))
      await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible()
      await page.goto(uiPath('/admin'))
      await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
      const before = await seedSealedLegacyAdministrator(page, admin)
      if (damaged) {
        // Reproduce 81dcdd8's unauthorized removal after the S1 seal, then an old logout.
        await page.evaluate(() => localStorage.removeItem('qwerty.cloudAuth.v1'))
        await page.getByLabel('管理员密码').fill('synthetic-password')
        await page.getByRole('button', { name: '进入管理控制台', exact: true }).click()
      } else await page.goto(uiPath('/mobile'))
      await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
      await page.getByRole('button', { name: '普通账号登录', exact: true }).click()
      if (damaged) {
        await expect(page.getByRole('heading', { name: '恢复普通账号登录' })).toBeVisible()
        const confirm = page.getByRole('button', { name: '保留数据并恢复普通登录' })
        await expect(confirm).toBeDisabled()
        await auditVisibleUI(page, info, 'administrator-return-recovery')
        await page.screenshot({ path: info.outputPath('administrator-return-recovery.png'), fullPage: true })
        await page.getByLabel('我确认先保留完整本机副本，再恢复普通账号登录').check()
        await confirm.click()
      }
      await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible({ timeout: 30000 })
      await expect(page.getByText('学习数据安全检查未通过', { exact: true })).toHaveCount(0)
      const after = await inspectReturnedWorkspace(page, adminId)
      expect(after.active).toEqual({ kind: 'anonymous' })
      expect(after.rows).toEqual([])
      expect(after.anonymousFingerprint).toBe(before.anonymousFingerprint)
      expect(after.adminSnapshot).toContain('preserved-admin-word')
      expect(after.rollbackCount).toBe(damaged ? 1 : 0)
      expect(after.auth).toBeNull()
      expect(after.management).toBeNull()
      expect(after.returnTicket).toBeNull()
      expect(network.calls.filter((c) => /\/api\/(sync|maintenance|circle)/.test(c.path))).toEqual([])
      await auditVisibleUI(page, info, 'administrator-return-ordinary-login')
    },
  )
}

test('administrator return does not repair another accounts damaged witness', async ({ page }) => {
  test.skip(pagesUI, 'Pages has no live identity verification.')
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/?s1-account=manage'))
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible()
  await page.goto(uiPath('/admin'))
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
  const before = await seedSealedLegacyAdministrator(page, admin, 'd'.repeat(32))
  await page.evaluate(() => localStorage.removeItem('qwerty.cloudAuth.v1'))
  await page.getByLabel('管理员密码').fill('synthetic-password')
  await page.getByRole('button', { name: '进入管理控制台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '普通账号登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '学习数据安全检查未通过' })).toBeVisible()
  await expect(page.getByRole('button', { name: '保留数据并恢复普通登录' })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('qwerty.s1.workspace-migrated.v1'))).toBe(before.witness)
})

test('administrator repair resumes its existing full backup after credential write failure', async ({ page }) => {
  test.skip(pagesUI, 'Pages has no authenticated repair.')
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/?s1-account=manage'))
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible()
  await page.goto(uiPath('/admin'))
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
  await seedSealedLegacyAdministrator(page, admin)
  await page.evaluate(() => localStorage.removeItem('qwerty.cloudAuth.v1'))
  await page.getByLabel('管理员密码').fill('synthetic-password')
  await page.getByRole('button', { name: '进入管理控制台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '普通账号登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '恢复普通账号登录' })).toBeVisible()
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    let failed = false
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'qwerty.cloudAuth.v1' && !failed) {
        failed = true
        throw Error('injected credential write interruption')
      }
      original.call(this, key, value)
    }
  })
  await page.getByLabel('我确认先保留完整本机副本，再恢复普通账号登录').check()
  await page.getByRole('button', { name: '保留数据并恢复普通登录' }).click()
  await expect(page.getByRole('button', { name: '重新检查恢复状态' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('qwerty.cloudAuth.v1'))).toBeNull()
  await page.getByRole('button', { name: '重新检查恢复状态' }).click()
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible({ timeout: 30000 })
  const after = await inspectReturnedWorkspace(page, adminId)
  expect(after.rollbackCount).toBe(1)
  expect(after.adminSnapshot).toContain('preserved-admin-word')
  expect(after.rows).toEqual([])
})

test('administrator recovery requires a fresh server authorization', async ({ page }) => {
  test.skip(pagesUI, 'Pages has no administrator authorization.')
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/?s1-account=manage'))
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible()
  await page.goto(uiPath('/admin'))
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
  const before = await seedSealedLegacyAdministrator(page, admin)
  await page.evaluate(() => localStorage.removeItem('qwerty.cloudAuth.v1'))
  await page.getByLabel('管理员密码').fill('synthetic-password')
  await page.getByRole('button', { name: '进入管理控制台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
  network.state.revoked = true
  await page.getByRole('button', { name: '普通账号登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '学习数据安全检查未通过' })).toBeVisible()
  await expect(page.getByRole('button', { name: '保留数据并恢复普通登录' })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('qwerty.s1.workspace-migrated.v1'))).toBe(before.witness)
  expect(await page.evaluate(() => localStorage.getItem('qwerty.cloudAuth.v1'))).toBeNull()
})

test('administrator fresh management-only origin returns to ordinary login', async ({ page }) => {
  test.skip(pagesUI, 'Pages has no authenticated login.')
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/admin'))
  await page.getByLabel('管理员密码').fill('synthetic-password')
  await page.getByRole('button', { name: '进入管理控制台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '普通账号登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible({ timeout: 15000 })
  const after = await inspectReturnedWorkspace(page, adminId)
  expect(after.active).toEqual({ kind: 'anonymous' })
  expect(after.rows).toEqual([])
  expect(after.auth).toBeNull()
  expect(network.calls.filter((c) => /\/api\/(sync|maintenance|circle)/.test(c.path))).toEqual([])
})

test('administrator recovery binds the actual server principal rather than cached account metadata', async ({ page }) => {
  test.skip(pagesUI, 'Pages has no authenticated recovery.')
  const network = api(page)
  await network.ready
  await page.goto(uiPath('/?s1-account=manage'))
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus', exact: true })).toBeVisible()
  await page.goto(uiPath('/admin'))
  await expect(page.getByRole('heading', { name: '登录管理控制台' })).toBeVisible()
  const before = await seedSealedLegacyAdministrator(page, admin, 'd'.repeat(32))
  await page.evaluate(() => localStorage.removeItem('qwerty.cloudAuth.v1'))
  await page.getByLabel('管理员密码').fill('synthetic-password')
  await page.getByRole('button', { name: '进入管理控制台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '运营概览', exact: true })).toBeVisible()
  await page.addInitScript(() => {
    if (new URLSearchParams(location.search).get('admin-return') === '1') {
      const auth = JSON.parse(sessionStorage.getItem('qwerty.administrator.return.v1') || 'null')
      if (auth) {
        auth.user.userId = 'd'.repeat(32)
        sessionStorage.setItem('qwerty.administrator.return.v1', JSON.stringify(auth))
      }
    }
  })
  await page.getByRole('button', { name: '普通账号登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '学习数据安全检查未通过' })).toBeVisible()
  await expect(page.getByRole('button', { name: '保留数据并恢复普通登录' })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('qwerty.s1.workspace-migrated.v1'))).toBe(before.witness)
})
