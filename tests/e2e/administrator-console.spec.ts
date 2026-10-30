import { uiPath, pagesUI } from './ui-test-path'
import { auditVisibleUI, prepareVisibleUI } from './ui-visible-audit'
import { expect, test, type Page } from '@playwright/test'

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
  const state = { revoked: false, overviewError: false, previewError: false, sent: false, deletions: 0 }
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
    if (path === '/api/admin/access') return reply({ administrator: bearer === 'Bearer ' + admin.token })
    if (path === '/api/admin/overview') return state.overviewError ? reply({ message: '统计暂不可用，请重试' }, 503) : reply(overview)
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
  expect(state.auth).toBe(legacy ? null : JSON.stringify(student))
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
