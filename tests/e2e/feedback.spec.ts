import { expect, test, type Page } from '@playwright/test'
import { createFeedbackService } from '../../cloud-functions/_shared/feedback.js'

const account = 'a'.repeat(32), admin = 'c'.repeat(32)
function cloud() {
  const blobs = new Map<string, any>()
  const service = createFeedbackService({
    store: {
      async get(key: string) { return structuredClone(blobs.get(key) ?? null) },
      async setJSON(key: string, value: unknown) { blobs.set(key, structuredClone(value)) },
      async list({ prefix, cursor, limit }: any) {
        const keys = [...blobs.keys()].filter(key => key.startsWith(prefix)).sort(), start = Number(cursor || 0)
        return { blobs: keys.slice(start, start + limit).map(key => ({ key })), cursor: start + limit < keys.length ? String(start + limit) : '' }
      },
    }, rateStorage: {}, backend: { async me(token: string) {
      if (![account, admin].includes(token)) throw Object.assign(Error('登录过期'), { statusCode: 401 })
      return { user: { userId: token, username: token === admin ? 'smhe' : 'student' } }
    } }, administrator: { isAdministrator: (identity: any) => identity.userId === admin },
  })
  let drop = false, malformed = false, reject = false, delay = 0
  async function attach(page: Page) {
    const sync: string[] = [], api: string[] = []
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()); api.push(url.pathname)
      if (url.pathname.includes('/sync')) sync.push(url.pathname)
      if (url.pathname === '/api/admin/access') return route.fulfill({ json: { ok: true, administrator: request.headers().authorization === 'Bearer ' + admin } })
      if (!url.pathname.startsWith('/api/feedback')) return route.fulfill({ status: 503, json: { ok: false } })
      if (reject && request.method() === 'POST') { reject = false; return route.fulfill({ status: 400, json: { ok: false, message: '请修改后重试。' } }) }
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      try {
        const value = await service.handle({ request: new Request(request.url(), { method: request.method(), headers: request.headers() }),
          clientIp: '192.0.2.' + (++ip), readBody: async () => request.postDataJSON() })
        if (malformed && request.method() === 'POST') { malformed = false; return route.fulfill({ json: { ok: true } }) }
        if (drop && request.method() === 'POST') { drop = false; return route.abort('connectionreset') }
        await route.fulfill({ json: { ok: true, ...value } })
      } catch (error: any) { await route.fulfill({ status: error.statusCode || 500, json: { ok: false, message: error.message } }) }
    })
    return { sync, api }
  }
  let ip = 0
  return { attach, blobs, loseResponse: () => { drop = true }, malformedResponse: () => { malformed = true }, rejectWrite: () => { reject = true }, slow: () => { delay = 500 } }
}
async function home(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(process.env.FEEDBACK_PAGES ? '/qwerty-learner/mobile' : '/mobile')
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 60000 })
}
async function open(page: Page) {
  await page.getByRole('button', { name: '反馈与建议', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}
async function create(page: Page, title: string) {
  await page.getByRole('button', { name: '写反馈', exact: true }).click()
  await page.getByLabel('标题', { exact: true }).fill(title)
  await page.getByLabel('具体内容', { exact: true }).fill('希望按钮更清晰 <script>alert(1)</script>')
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}
async function become(page: Page, id: string) {
  // Presentation fixture only: real account/ownership verification is covered in cloud contracts.
  await page.evaluate(id => localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({ user: { userId: id, username: id.startsWith('c') ? 'smhe' : 'student' }, token: id, expiresAt: Date.now() / 1000 + 3600 })), id)
}

test('anonymous feedback, private recovery, admin reply and follow-up; no sync', async ({ page, browser }) => {
  test.skip(!!process.env.FEEDBACK_PAGES)
  const backend = cloud(), requests = await backend.attach(page)
  await home(page); await open(page); await create(page, '手机按钮建议')
  await page.getByRole('button', { name: '保存私密链接' }).click()
  const link = await page.getByLabel('匿名反馈私密链接', { exact: true }).inputValue()
  await expect(page.getByText('希望按钮更清晰 <script>alert(1)</script>', { exact: true })).toBeVisible()
  const adminContext = await browser.newContext(), adminPage = await adminContext.newPage()
  await backend.attach(adminPage); await home(adminPage); await become(adminPage, admin); await open(adminPage)
  await adminPage.getByRole('button', { name: '管理全部反馈' }).click()
  await adminPage.getByRole('button', { name: /手机按钮建议/ }).click()
  await adminPage.getByLabel('继续交流', { exact: true }).fill('已经调整，谢谢反馈')
  await adminPage.getByLabel('处理状态', { exact: true }).selectOption('resolved')
  await adminPage.getByRole('button', { name: '发送', exact: true }).click()
  await expect(adminPage.getByText('已经调整，谢谢反馈', { exact: true })).toBeVisible()
  const recoveryContext = await browser.newContext(), recovered = await recoveryContext.newPage()
  await backend.attach(recovered); await recovered.setViewportSize({ width: 320, height: 700 }); await recovered.goto(link)
  await expect(recovered.getByRole('dialog', { name: '反馈与建议' })).toBeVisible({ timeout: 60000 })
  await expect(recovered).not.toHaveURL(/feedback=/)
  await recovered.getByRole('button', { name: /手机按钮建议/ }).click()
  await expect(recovered.getByText('已经调整，谢谢反馈', { exact: true })).toBeVisible()
  await recovered.getByLabel('继续交流', { exact: true }).fill('现在好了')
  await recovered.getByRole('button', { name: '发送', exact: true }).click()
  await expect(recovered.getByText('现在好了', { exact: true })).toBeVisible()
  await recovered.screenshot({ path: 'blob-report/feedback/mobile.png' })
  expect(await recovered.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '关闭反馈' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  expect(requests.sync).toEqual([])
  await adminContext.close(); await recoveryContext.close()
})

test('lost response survives refresh and retries original message once, including slow reads', async ({ page }) => {
  test.skip(!!process.env.FEEDBACK_PAGES)
  const backend = cloud(); await backend.attach(page); await home(page); await open(page)
  await page.getByRole('button', { name: '写反馈' }).click()
  await page.getByLabel('标题', { exact: true }).fill('断网测试')
  await page.getByLabel('具体内容', { exact: true }).fill('不能重复发送')
  backend.malformedResponse()
  await page.getByRole('button', { name: '提交反馈' }).click()
  await expect(page.getByRole('button', { name: '重试发送' })).toBeEnabled()
  await page.reload(); await expect(page.locator('[data-mobile-menu]')).toBeVisible(); backend.slow(); await open(page)
  await page.getByRole('button', { name: '重试发送' }).click()
  await expect(page.getByRole('heading', { name: '断网测试' })).toBeVisible()
  expect([...backend.blobs.keys()].filter(key => key.endsWith('/root.json'))).toHaveLength(1)
  await page.getByLabel('继续交流', { exact: true }).fill('补充一次')
  backend.loseResponse(); await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('button', { name: '重试发送' })).toBeEnabled()
  await page.reload(); await expect(page.locator('[data-mobile-menu]')).toBeVisible(); await open(page)
  await page.getByRole('button', { name: '重试发送' }).click()
  await expect(page.getByText('补充一次', { exact: true })).toBeVisible()
  expect([...backend.blobs.keys()].filter(key => key.includes('/messages/'))).toHaveLength(1)
})

test('PC account menu and anonymous settings use same dialog without learning navigation or sync', async ({ page }) => {
  test.skip(!!process.env.FEEDBACK_PAGES)
  const backend = cloud(), requests = await backend.attach(page)
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/learn')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 60000 })
  const initial = page.url()
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('button', { name: '反馈与建议', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '反馈与建议' })).toBeVisible()
  await create(page, '桌面建议'); await page.getByRole('button', { name: '关闭反馈' }).click()
  expect(page.url()).toBe(initial)
  await become(page, account)
  // Mount a fresh desktop route after installing the synthetic presentation identity.
  // This stays in the same document; actual session authorization is tested server-side.
  await page.evaluate(() => { history.pushState({}, '', '/typing'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await expect(page.locator('[data-account-menu-toggle]')).toBeVisible()
  await page.locator('[data-account-menu-toggle]').click()
  await page.getByRole('menuitem', { name: '反馈与建议' }).click()
  await expect(page.getByRole('dialog', { name: '反馈与建议' })).toBeVisible()
  await expect(page.getByRole('button', { name: /桌面建议/ })).toHaveCount(0)
  await create(page, '账号建议')
  await page.screenshot({ path: 'blob-report/feedback/desktop.png' })
  await page.getByRole('button', { name: '关闭反馈' }).click()
  expect(new URL(page.url()).pathname).toBe('/typing'); expect(requests.sync).toEqual([])
})

test('Pages explains unavailable feedback and makes no API requests', async ({ page }) => {
  test.skip(!process.env.FEEDBACK_PAGES)
  const backend = cloud(), requests = await backend.attach(page)
  await home(page); await open(page)
  await expect(page.getByText('预览站不提供在线反馈，请在正式站使用此功能。')).toBeVisible()
  expect(requests.api).toEqual([])
})


test('explicit rejected submission keeps editable content and does not leave an ambiguous operation', async ({ page }) => {
  test.skip(!!process.env.FEEDBACK_PAGES)
  const backend = cloud(); await backend.attach(page); await home(page); await open(page)
  await page.getByRole('button', { name: '写反馈' }).click()
  await page.getByLabel('标题', { exact: true }).fill('保留草稿')
  await page.getByLabel('具体内容', { exact: true }).fill('被拒绝后可修改')
  backend.rejectWrite()
  await page.getByRole('button', { name: '提交反馈' }).click()
  await expect(page.getByRole('alert')).toHaveText('请修改后重试。')
  await expect(page.getByRole('button', { name: '重试发送' })).toHaveCount(0)
  await expect(page.getByLabel('具体内容', { exact: true })).toHaveValue('被拒绝后可修改')
  await page.getByLabel('具体内容', { exact: true }).fill('修改后的反馈')
  await page.getByRole('button', { name: '提交反馈' }).click()
  await expect(page.getByText('修改后的反馈', { exact: true })).toBeVisible()
  expect([...backend.blobs.keys()].filter(key => key.endsWith('/root.json'))).toHaveLength(1)
})
