import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
// Playwright transpiles this spec to CJS. Native dynamic import also supports
// the Cloud Functions ESM package on CI's Node 20 (local Node 22 supports require).
let createFeedbackService: any
test.beforeAll(async () => {
  const nativeImport = new Function('specifier', 'return import(specifier)')
  ;({ createFeedbackService } = await nativeImport(pathToFileURL(resolve(process.cwd(), 'cloud-functions/_shared/feedback.js')).href))
})

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
    const sync: string[] = [], api: string[] = [], feedback: { authorization?: string; guest?: string }[] = []
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()); api.push(url.pathname)
      if (url.pathname.includes('/sync')) sync.push(url.pathname)
      if (url.pathname === '/api/admin/access') return route.fulfill({ json: { ok: true, administrator: request.headers().authorization === 'Bearer ' + admin } })
      if (!url.pathname.startsWith('/api/feedback')) return route.fulfill({ status: 503, json: { ok: false } })
      feedback.push({ authorization: request.headers().authorization, guest: request.headers()['x-feedback-key'] })
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
    return { sync, api, feedback }
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
async function create(page: Page, title: string, screenshot?: string) {
  await page.getByRole('button', { name: '写反馈', exact: true }).click()
  await expect(page.getByRole('button', { name: /^(刷新|保存私密链接|查看匿名反馈|查看账号反馈)$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '返回反馈列表', exact: true })).toHaveCount(1)
  await page.getByLabel('标题', { exact: true }).fill(title)
  expect(await page.locator('.feedback-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  if (screenshot) await page.locator('.feedback-panel').screenshot({ path: screenshot })
  await page.getByLabel('具体内容', { exact: true }).fill('希望按钮更清晰 <script>alert(1)</script>')
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}
async function become(page: Page, id: string) {
  // Presentation fixture only: real account/ownership verification is covered in cloud contracts.
  await page.evaluate(id => localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({ user: { userId: id, username: id.startsWith('c') ? 'smhe' : 'student' }, token: id, expiresAt: Date.now() / 1000 + 3600 })), id)
}

async function copyFeedback(page: Page, title: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: '复制反馈', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('反馈及回复已复制')
  // Windows native clipboard returns CRLF even when writeText receives LF.
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')
  expect(copied).toContain(title + '\n处理状态：')
  expect(copied).toContain('反馈内容\n希望按钮更清晰 <script>alert(1)</script>')
  expect(copied).not.toContain('feedback=')
  expect(copied).not.toContain(account)
  expect(copied).not.toContain(admin)
  return copied
}

test('anonymous feedback, private recovery, admin reply and follow-up; no sync', async ({ page, browser }) => {
  test.skip(!!process.env.FEEDBACK_PAGES)
  const backend = cloud(), requests = await backend.attach(page)
  await home(page); await open(page); await create(page, '手机按钮建议', 'blob-report/feedback/mobile-form.png')
  await copyFeedback(page, '手机按钮建议')
  await page.getByRole('button', { name: '保存私密链接' }).click()
  const link = await page.getByLabel('匿名反馈私密链接', { exact: true }).inputValue()
  await expect(page.getByRole('article').getByText('希望按钮更清晰 <script>alert(1)</script>', { exact: true })).toBeVisible()
  const adminContext = await browser.newContext(), adminPage = await adminContext.newPage()
  const adminRequests = await backend.attach(adminPage); await home(adminPage); await become(adminPage, admin); await open(adminPage)
  await adminPage.getByRole('button', { name: '管理全部反馈' }).click()
  await adminPage.getByRole('button', { name: /手机按钮建议/ }).click()
  await adminPage.getByLabel('继续交流', { exact: true }).fill('已经调整，谢谢反馈')
  await adminPage.getByLabel('处理状态', { exact: true }).selectOption('resolved')
  await adminPage.getByRole('button', { name: '发送', exact: true }).click()
  await expect(adminPage.getByRole('article').getByText('已经调整，谢谢反馈', { exact: true })).toBeVisible()
  const beforeCopy = adminRequests.api.length
  const copied = await copyFeedback(adminPage, '手机按钮建议')
  expect(copied).toContain('已经调整，谢谢反馈')
  expect(copied).toContain('管理员')
  expect(adminRequests.api).toHaveLength(beforeCopy)
  // Native clipboard denial must leave selectable text and must not send anything.
  await adminPage.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
    configurable: true, value: async () => { throw new DOMException('Denied', 'NotAllowedError') },
  }))
  await adminPage.getByRole('button', { name: '复制反馈', exact: true }).click()
  await expect(adminPage.getByRole('alert')).toHaveText('无法访问剪贴板，请选中反馈文字后手动复制。')
  const content = adminPage.locator('.feedback-text').first()
  expect(await content.evaluate(el => getComputedStyle(el).userSelect)).toBe('text')
  const selected = await content.evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    return selection.toString()
  })
  expect(selected).toBe('希望按钮更清晰 <script>alert(1)</script>')
  expect(adminRequests.api).toHaveLength(beforeCopy)
  await adminPage.locator('.feedback-panel').screenshot({ path: 'blob-report/completion-feedback-copy/admin-copy.png' })
  const recoveryContext = await browser.newContext(), recovered = await recoveryContext.newPage()
  await backend.attach(recovered); await recovered.setViewportSize({ width: 320, height: 700 }); await recovered.goto(link)
  await expect(recovered.getByRole('dialog', { name: '反馈与建议' })).toBeVisible({ timeout: 60000 })
  await expect(recovered).not.toHaveURL(/feedback=/)
  await recovered.getByRole('button', { name: /手机按钮建议/ }).click()
  await expect(recovered.getByRole('article').getByText('已经调整，谢谢反馈', { exact: true })).toBeVisible()
  await recovered.getByLabel('继续交流', { exact: true }).fill('现在好了')
  await recovered.getByRole('button', { name: '发送', exact: true }).click()
  await expect(recovered.getByRole('article').getByText('现在好了', { exact: true })).toBeVisible()
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
  await expect(page.getByRole('article').getByText('补充一次', { exact: true })).toBeVisible()
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
  await expect(page.getByRole('button', { name: /查看匿名反馈|查看账号反馈/ })).toHaveCount(0)
  await page.locator('.feedback-panel').screenshot({ path: 'blob-report/feedback/desktop-empty.png' })
  await create(page, '账号建议', 'blob-report/feedback/desktop-form.png')
  await copyFeedback(page, '账号建议')
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
  await expect(page.getByRole('article').getByText('修改后的反馈', { exact: true })).toBeVisible()
  expect([...backend.blobs.keys()].filter(key => key.endsWith('/root.json'))).toHaveLength(1)
})


test('identity follows login only, including anonymous recovery links and logout', async ({ page }) => {
  test.skip(!!process.env.FEEDBACK_PAGES)
  const backend = cloud(), requests = await backend.attach(page)
  await home(page); await open(page); await create(page, '原匿名反馈')
  await page.getByRole('button', { name: '保存私密链接' }).click()
  const link = await page.getByLabel('匿名反馈私密链接', { exact: true }).inputValue()
  const originalKey = await page.evaluate(() => localStorage.getItem('qwerty.feedback.active.v1'))
  await page.getByRole('button', { name: '关闭反馈' }).click()
  await become(page, account)
  requests.feedback.length = 0
  // SPA link navigation isolates feedback identity from the learning-session bootstrap fixture.
  await page.evaluate(link => { history.pushState({}, '', link); window.dispatchEvent(new PopStateEvent('popstate')) }, link)
  const dialog = page.getByRole('dialog', { name: '反馈与建议' })
  await expect(dialog).toBeVisible()
  await expect(page).not.toHaveURL(/feedback=/)
  await expect(page.getByRole('button', { name: '写反馈', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: /原匿名反馈|查看匿名反馈|查看账号反馈|保存私密链接/ })).toHaveCount(0)
  await expect(page.getByLabel('匿名入口')).toHaveCount(0)
  await create(page, '当前账号反馈')
  expect(requests.feedback.length).toBeGreaterThan(0)
  expect(requests.feedback.every(request => request.authorization === 'Bearer ' + account && !request.guest)).toBe(true)
  await page.getByRole('button', { name: '关闭反馈' }).click()
  await page.evaluate(() => localStorage.removeItem('qwerty.cloudAuth.v1'))
  requests.feedback.length = 0
  await open(page)
  await expect(page.getByRole('button', { name: /原匿名反馈/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /当前账号反馈/ })).toHaveCount(0)
  expect(requests.feedback.every(request => request.guest === originalKey && !request.authorization)).toBe(true)
  expect(requests.sync).toEqual([])
})

test('a changed or expired login never silently submits as anonymous', async ({ page }) => {
  test.skip(!!process.env.FEEDBACK_PAGES)
  const backend = cloud(), requests = await backend.attach(page)
  await home(page); await open(page)
  await page.getByRole('button', { name: '写反馈', exact: true }).click()
  await page.getByLabel('标题', { exact: true }).fill('登录变更')
  await page.getByLabel('具体内容', { exact: true }).fill('不应落入旧匿名身份')
  await page.setViewportSize({ width: 320, height: 700 })
  expect(await page.locator('.feedback-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.locator('.feedback-panel').screenshot({ path: 'blob-report/feedback/mobile-320-form.png' })
  await become(page, account)
  const before = requests.feedback.length
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('登录状态已改变，请关闭后重新打开反馈。')
  expect(requests.feedback).toHaveLength(before)
  expect([...backend.blobs.keys()].filter(key => key.endsWith('/root.json'))).toHaveLength(0)
  await page.getByRole('button', { name: '关闭反馈' }).click()
  await become(page, 'd'.repeat(32))
  requests.feedback.length = 0
  await open(page)
  await expect(page.getByRole('alert')).toHaveText('登录已失效，请重新登录后查看或发送反馈。')
  expect(requests.feedback.length).toBeGreaterThan(0)
  expect(requests.feedback.every(request => request.authorization === 'Bearer ' + 'd'.repeat(32) && !request.guest)).toBe(true)
  await expect(page.getByRole('button', { name: '保存私密链接' })).toHaveCount(0)
  expect(requests.sync).toEqual([])
})


async function readableFeedback(page: Page) {
  // Check every rendered text node and placeholder against its painted background,
  // including buttons, metadata, form labels, replies and disabled controls.
  const failures = await page.locator('.feedback-panel').evaluate(panel => {
    const rgb = (value: string) => {
      const channels = (value.match(/[0-9.]+/g) || []).map(Number)
      if (channels.length < 3 || channels.some(n => !Number.isFinite(n))) throw Error('Invalid computed color: ' + value)
      return channels
    }
    const luminance = (channels: number[]) => channels.slice(0, 3).map(v => {
      const n = v / 255
      return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
    const background = (element: Element): number[] => {
      const color = rgb(getComputedStyle(element).backgroundColor)
      return color.length === 3 || color[3] === 1 ? color : element.parentElement ? background(element.parentElement) : [255, 255, 255]
    }
    const results: { text: string; ratio: number }[] = []
    const check = (element: Element, text: string, pseudo?: string) => {
      if (!element.getClientRects().length || !text.trim()) return
      const style = getComputedStyle(element, pseudo)
      const a = luminance(rgb(style.color)), b = luminance(background(element))
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      if (!Number.isFinite(ratio) || ratio < 4.5) results.push({ text: text.slice(0, 45), ratio })
    }
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (node.parentElement) check(node.parentElement, node.textContent || '')
    }
    panel.querySelectorAll('input,textarea').forEach(element => {
      const field = element as HTMLInputElement
      check(element, field.value)
      check(element, field.placeholder, '::placeholder')
    })
    return results
  })
  expect(failures).toEqual([])
}

for (const dark of [false, true]) {
  test('all feedback text remains readable in ' + (dark ? 'dark' : 'light') + ' mode', async ({ page }) => {
    test.skip(!!process.env.FEEDBACK_PAGES)
    await page.addInitScript(value => localStorage.setItem('isOpenDarkModeAtom', JSON.stringify(value)), dark)
    const backend = cloud(); await backend.attach(page); await home(page)
    await become(page, admin); await open(page)
    await readableFeedback(page)
    // Prove this check detects unreadable text, rather than passing invalid color math.
    await page.locator('.feedback-heading h2').evaluate(el => {
      (el as HTMLElement).style.color = getComputedStyle(document.querySelector('.feedback-panel')!).backgroundColor
    })
    await expect(readableFeedback(page)).rejects.toThrow()
    await page.locator('.feedback-heading h2').evaluate(el => { (el as HTMLElement).style.color = '' })
    await readableFeedback(page)
    await page.getByRole('button', { name: '关闭反馈' }).hover()
    await readableFeedback(page)
    await page.getByRole('button', { name: '写反馈', exact: true }).hover()
    await readableFeedback(page)
    await page.locator('.feedback-panel').screenshot({ path: 'blob-report/feedback/contrast-' + (dark ? 'dark' : 'light') + '-empty.png' })
    await page.getByRole('button', { name: '写反馈', exact: true }).click()
    await readableFeedback(page)
    await page.getByLabel('标题', { exact: true }).fill('深浅色可读性')
    await page.getByLabel('具体内容', { exact: true }).fill('检查标题、正文和提示文字')
    backend.rejectWrite()
    await page.getByRole('button', { name: '提交反馈', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await readableFeedback(page)
    await page.getByRole('button', { name: '提交反馈', exact: true }).click()
    await expect(page.getByRole('heading', { name: '深浅色可读性' })).toBeVisible()
    await page.getByLabel('继续交流', { exact: true }).fill('管理员回复同样清楚')
    await page.getByLabel('处理状态', { exact: true }).selectOption('resolved')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('article').getByText('管理员回复同样清楚')).toBeVisible()
    await page.getByRole('button', { name: '复制反馈', exact: true }).hover()
    await readableFeedback(page)
    await page.locator('.feedback-panel').screenshot({ path: 'blob-report/feedback/contrast-' + (dark ? 'dark' : 'light') + '-thread.png' })
  })
}
