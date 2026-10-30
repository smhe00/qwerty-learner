import { uiPath, pagesUI } from './ui-test-path'
import { readGuideLearningState } from './user-guide-state'
import { chooseLearnInputMode } from './learn-input-mode-harness'
import { reviewWords, seedAcquisitionSession, seedReviewSession } from './review-flow-harness'
import { auditVisibleUI, prepareVisibleUI } from './ui-visible-audit'
import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'

test.beforeEach(async ({ page }, info) => prepareVisibleUI(page, info.project.name.endsWith('dark')))

test('responsive layout returns to desktop after automatic narrowing and retains explicit touch routes', async ({ page }, info) => {
  const desktop = info.project.name.startsWith('desktop')
  const apiCalls: string[] = []
  if (pagesUI) page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()) })
  if (desktop) {
    await page.goto(uiPath('/learn'))
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 30_000 })
    for (const path of ['/learn?layout=roundtrip#learn', '/typing?layout=roundtrip#typing']) {
      await page.goto(uiPath(path))
      await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 30_000 })
      const before = await readGuideLearningState(page)
      const documentState = await page.evaluate(() => ({ origin: performance.timeOrigin, history: history.length }))
      for (const [narrow, wide] of [[700, 701], [390, 1440]]) {
        await page.setViewportSize({ width: narrow, height: 900 })
        await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
        await expect(page).toHaveURL(new RegExp('/mobile$'))
        await auditVisibleUI(page, info, 'responsive-narrow-' + narrow)
        await page.setViewportSize({ width: wide, height: 900 })
        await expect(page).toHaveURL(new RegExp(path.replace('?', '\\?') + '$'))
        await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 30_000 })
      }
      await auditVisibleUI(page, info, 'responsive-desktop-restored')
      expect(await page.evaluate(() => ({ origin: performance.timeOrigin, history: history.length }))).toEqual(documentState)
      expect(await readGuideLearningState(page)).toBe(before)
    }
  }
  // Explicit mobile URLs remain intentional, including a mouse-first PC.
  await page.goto(uiPath('/mobile'))
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
  const origin = await page.evaluate(() => performance.timeOrigin)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page).toHaveURL(/\/mobile$/)
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
  if (!desktop) {
    // A wide primary touch device must still select the touch home itself.
    await page.goto(uiPath('/'))
    await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/\/mobile$/)
  } else expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
  await auditVisibleUI(page, info, 'responsive-explicit-touch')
  expect(apiCalls).toEqual([])
})

test('all mobile menu destinations and lazy return remain readable', async ({ page }, info) => {
  await page.goto(uiPath('/mobile'))
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await auditVisibleUI(page, info, 'home')
  for (const [name, path, ready] of [
    ['词库', '/mobile/library', '选择词库'],
    ['设置', '/mobile/settings', '学习设置'],
    ['学习记录', '/mobile/history', '学习记录'],
    ['账号与云同步', '/mobile/data', '账号与云同步'],
    ['成就', '/mobile/achievements', '成就'],
    ['使用指南', '/mobile/guide', '使用指南'],
  ]) {
    await page.getByRole('link', { name: new RegExp('^' + name) }).click()
    await expect(page).toHaveURL(new RegExp(path + '$'))
    await expect(page.getByRole('heading', { name: ready, exact: true }).first()).toBeVisible()
    await auditVisibleUI(page, info, path.replaceAll('/', '-'))
    if (path === '/mobile/settings') {
      await page.getByLabel('每日新词目标').fill('15')
      const save = page.getByRole('button', { name: '保存设置', exact: true })
      await save.scrollIntoViewIfNeeded()
      await expect(save).toBeInViewport()
      await auditVisibleUI(page, info, 'settings-save')
      await save.click()
      await expect(page.getByRole('status')).toContainText('设置已保存在本机')
    }
    if (path === '/mobile/data' && !pagesUI) {
      await page.getByText('更多同步选项', { exact: true }).click()
      await page.getByText('从备份恢复', { exact: true }).click()
      await auditVisibleUI(page, info, 'data-expanded')
    }
    await page.goBack()
    await expect(page.locator('[data-mobile-menu]')).toBeVisible()
    await auditVisibleUI(page, info, 'home-after-' + path.split('/').pop())
  }
  await page.getByRole('button', { name: '反馈与建议', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '反馈与建议' })).toBeVisible()
  await auditVisibleUI(page, info, 'feedback-unavailable')
  if (pagesUI) {
    await expect(page.getByRole('dialog', { name: '反馈与建议' })).toContainText('预览')
    await page.getByRole('button', { name: '关闭反馈' }).click()
    await expect(page.locator('[data-mobile-menu]')).toBeVisible()
    return
  }
  await page.getByRole('button', { name: '写反馈', exact: true }).click()
  await auditVisibleUI(page, info, 'feedback-compose')
  await page.getByLabel('标题', { exact: true }).fill('界面可见性检查')
  await page.getByLabel('具体内容', { exact: true }).fill('测试文字换行与提交状态，禁止发送到真实服务。')
  await page.getByRole('button', { name: '提交反馈', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await auditVisibleUI(page, info, 'feedback-send-error')
  await page.getByRole('button', { name: '关闭反馈' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
})

test('login and register forms remain actionable after validation errors', async ({ page }, info) => {
  await page.goto(uiPath('/mobile/account'))
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' })).toBeVisible()
  await auditVisibleUI(page, info, 'account-login')
  await page.getByRole('tab', { name: '注册', exact: true }).click()
  await auditVisibleUI(page, info, 'account-register')
  await page.getByText('账号保留规则', { exact: true }).click()
  await auditVisibleUI(page, info, 'account-rules-expanded')
  await page.getByRole('tab', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await auditVisibleUI(page, info, 'account-validation')
})

for (const phase of ['exposure', 'supported', 'independent'] as const) {
  test('learning actions and exits: ' + phase, async ({ page }, info) => {
    await seedAcquisitionSession(page, reviewWords, 981001, phase)
    await page.goto(uiPath('/mobile/study'))
    const card = page.locator('[data-mobile-word-practice]')
    await expect(card).toBeVisible()
    await auditVisibleUI(page, info, 'learn-' + phase)
    await page.getByRole('button', { name: '暂停学习', exact: true }).click()
    await auditVisibleUI(page, info, 'learn-paused-' + phase)
    await card
      .locator('.mobile-practice-overlay')
      .getByRole('button', { name: /^继续学习/ })
      .click()
    if (phase === 'exposure') {
      await card.getByRole('button', { name: '继续学习', exact: true }).click()
      await card.getByRole('button', { name: '停留查看', exact: true }).click()
      await auditVisibleUI(page, info, 'learn-manual-next')
      await card.locator('[data-mobile-manual-next]').click()
    } else if (phase === 'supported') {
      const fallback = card.getByRole('button', { name: /先练词义|无法播放/ }).first()
      if (await fallback.isVisible()) await fallback.click()
      await auditVisibleUI(page, info, 'learn-meaning-choices')
      await card.locator('[data-mobile-choice]').first().click()
      const hold = card.getByRole('button', { name: '停留查看', exact: true })
      if (await hold.isVisible()) await hold.click()
      await auditVisibleUI(page, info, 'learn-choice-feedback')
    } else {
      await card.locator('[data-mobile-grade="hard"]').click()
      await auditVisibleUI(page, info, 'learn-recall-feedback')
      await card.locator('[data-mobile-manual-next]').click()
      await chooseLearnInputMode(page, 'keyboard')
      await auditVisibleUI(page, info, 'learn-spelling')
      const field = card.getByRole('textbox', { name: '独立拼写单词' })
      await field.fill('wrong')
      await card.getByRole('button', { name: /^确认拼写/ }).click()
      await auditVisibleUI(page, info, 'learn-spelling-judgment')
    }
  })
}

test('desktop settings tabs and auxiliary pages stay usable', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'Desktop-only shell; mobile routes have their own full matrix.')
  await page.goto(uiPath('/learn'))
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await auditVisibleUI(page, info, 'desktop-learn')
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.focus-settings-dialog')).toBeVisible()
  const names = await dialog.getByRole('tab').allTextContents()
  for (const name of names) {
    await dialog.getByRole('tab', { name: name.trim(), exact: true }).click()
    await auditVisibleUI(page, info, 'desktop-settings-' + name.trim())
  }
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  await page.evaluate((analysisPath) => {
    const originalGetAll = IDBIndex.prototype.getAll
    const originalCursor = IDBIndex.prototype.openCursor
    const blocked = (index: IDBIndex) => index.objectStore.name === 'wordRecords' && index.name === 'timeStamp'
    IDBIndex.prototype.getAll = function (...args) {
      if (blocked(this)) throw new DOMException('UI audit statistics read failure', 'UnknownError')
      return originalGetAll.apply(this, args)
    }
    IDBIndex.prototype.openCursor = function (...args) {
      if (blocked(this)) throw new DOMException('UI audit statistics read failure', 'UnknownError')
      return originalCursor.apply(this, args)
    }
    ;(window as any).__restoreUIStatsRead = () => {
      IDBIndex.prototype.getAll = originalGetAll
      IDBIndex.prototype.openCursor = originalCursor
    }
    history.pushState(null, '', analysisPath)
    dispatchEvent(new PopStateEvent('popstate'))
  }, uiPath('/analysis'))
  await expect(page.getByRole('alert')).toContainText('统计数据暂时无法读取')
  await auditVisibleUI(page, info, 'desktop-statistics-read-error')
  await page.evaluate(() => (window as any).__restoreUIStatsRead())
  await page.getByRole('button', { name: '重试读取统计', exact: true }).click()
  await expect(page.getByText('暂无练习数据', { exact: true })).toBeVisible()
  await auditVisibleUI(page, info, 'desktop-statistics-empty')
  for (const path of [
    '/typing',
    '/gallery',
    '/analysis',
    '/analysis?from=learn',
    '/error-book',
    '/friend-links',
    '/achievements',
    '/circles',
  ]) {
    await page.goto(uiPath(path))
    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page.getByText('正在准备本地学习数据', { exact: true })).toHaveCount(0)
    if (path === '/analysis') await expect(page.getByText('暂无练习数据', { exact: true }).or(page.locator('canvas').first())).toBeVisible()
    if (path === '/analysis?from=learn') await expect(page.getByRole('heading', { name: 'Learn 数据统计', exact: true })).toBeVisible()
    await auditVisibleUI(page, info, 'desktop-' + path.slice(1).replace('?', '-'))
    if (path === '/typing') {
      await page.getByRole('button', { name: '开始练习', exact: true }).click()
      await expect(page.locator('.focus-word-stack')).not.toHaveAttribute('inert', '')
      await auditVisibleUI(page, info, 'desktop-typing-active')
      await page.getByRole('button', { name: '打开单词列表' }).click()
      await auditVisibleUI(page, info, 'desktop-word-list')
      await page.getByRole('button', { name: '关闭单词列表' }).click()
    }
  }
})

test('guarded backup import and local reset are readable without performing destructive actions', async ({ page }, info) => {
  test.skip(pagesUI, 'S1 isolated workspace tools require the EdgeOne build; retained in the companion matrix.')
  await page.goto(uiPath('/mobile'))
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  for (const [query, heading] of [
    ['v4-import=manage', '本地导入完整 Backup V4'],
    ['s1-clear=manage', '清除当前工作区的本地学习数据'],
  ]) {
    await page.goto(uiPath('/?' + query))
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await auditVisibleUI(page, info, query.split('=')[0])
    const cancel = page.getByRole('button', { name: /取消.*返回学习/ })
    await cancel.scrollIntoViewIfNeeded()
    await auditVisibleUI(page, info, query.split('=')[0] + '-cancel')
    await cancel.click()
    await expect(page.locator('[data-mobile-menu], .focus-app-shell')).toBeVisible()
  }
})

test('circle empty, forms, errors and all detail tabs stay readable', async ({ page }, info) => {
  test.skip(pagesUI, 'Circle requires authenticated cloud transport; retained with intercepted APIs in the companion matrix.')
  const owner = 'ui-audit-owner',
    circleId = 'a'.repeat(24)
  let exists = false
  await page.route('**/api/circle/v2/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/circle/v2', '')
    const send = (result: unknown) => route.fulfill({ json: { ok: true, result } })
    if (path === '/mine') return send({ circles: exists ? [{ circleId, name: '每天十分钟', role: 'owner' }] : [] })
    if (path === '/' + circleId && route.request().method() === 'GET')
      return send({
        schemaVersion: 3,
        circleId,
        day: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
        ownerInviteCode: '每天学English',
        meta: { name: '每天十分钟', ownerUserId: owner, softMemberLimit: 50, inviteMode: 'custom', inviteRevision: 'fixture' },
        members: [
          { userId: owner, role: 'owner', nickname: '小禾' },
          { userId: 'ui-audit-friend', role: 'member', nickname: '同学' },
        ],
        progress: [],
        reactionCounts: [],
      })
    return route.fulfill({ status: 503, json: { ok: false, error: 'circle_internal_error' } })
  })
  await page.goto(uiPath('/mobile'))
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  // Synthetic credentials only after guarded boot; all APIs are intercepted.
  // Stay in the same SPA document, so no real account workspace is opened.
  await page.evaluate((owner) => {
    localStorage.setItem(
      'qwerty.cloudAuth.v1',
      JSON.stringify({
        token: 'ui-audit-only',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        user: { userId: owner, username: '小禾', createdAt: '2026-10-01' },
      }),
    )
    window.dispatchEvent(new Event('focus'))
  }, owner)
  await page.getByRole('button', { name: '打开圈子', exact: true }).click()
  await expect(page.getByRole('button', { name: '创建', exact: true })).toBeVisible()
  await auditVisibleUI(page, info, 'circle-empty')
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await auditVisibleUI(page, info, 'circle-create')
  await page.getByLabel('圈子名称', { exact: true }).fill('界面检查测试圈')
  await page.getByLabel('入圈口令', { exact: true }).fill('今天学English')
  await page.getByLabel('圈内昵称', { exact: true }).fill('测试同学')
  await page.getByRole('button', { name: '创建圈子', exact: true }).click()
  await expect(page.locator('.circle-error')).toBeVisible()
  await auditVisibleUI(page, info, 'circle-create-error')
  await page.getByRole('button', { name: '收起', exact: true }).click()
  await page.getByRole('button', { name: '口令加入', exact: true }).click()
  await auditVisibleUI(page, info, 'circle-join')
  await page.getByRole('button', { name: '收起', exact: true }).click()
  exists = true
  await page.getByRole('button', { name: '刷新圈子' }).click()
  await page.getByRole('button', { name: /每天十分钟/ }).click()
  for (const tab of ['动态', '邀请同学', '圈子管理']) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    await auditVisibleUI(page, info, 'circle-' + tab)
  }
})

test('Song achievements, history and dictionary empty search remain readable', async ({ page }, info) => {
  await page.goto(uiPath('/mobile'))
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const tx = db.transaction('wordRecords', 'readwrite')
      for (const days of [1, 2, 3]) {
        const date = new Date()
        date.setHours(12, 0, 0, 0)
        date.setDate(date.getDate() - days)
        tx.objectStore('wordRecords').add({
          dict: 'cet4',
          word: days === 1 ? 'cancel' : 'ui-history-' + days,
          chapter: -1,
          timeStamp: Math.floor(date.getTime() / 1000),
          timing: [200],
          wrongCount: days === 1 ? 1 : 0,
          mistakes: {},
          sourceMode: 'learn',
          learnItemKind: 'acquisition',
        })
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  })
  await page.getByRole('link', { name: /^成就/ }).click()
  await page.getByRole('button', { name: '开启宋韵雅藏' }).click()
  await expect(page.locator('[data-song-achievement-gallery]')).toBeVisible()
  await expect(page.locator('.song-portal-entry')).toBeHidden()
  await auditVisibleUI(page, info, 'song-gallery')
  await page.getByRole('button', { name: /^(夜卷|晨卷)$/ }).click()
  await auditVisibleUI(page, info, 'song-theme-switch')
  await page.getByLabel('成就排序').selectOption({ index: 1 })
  await auditVisibleUI(page, info, 'song-sorted')
  await page.getByRole('button', { name: '展卷演示', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await auditVisibleUI(page, info, 'song-detail')
  for (let step = 0; step < 5; step++) {
    await page.keyboard.press('Tab')
    await expect.poll(() => page.getByRole('dialog').evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }
  await page.getByRole('button', { name: '关闭藏品', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '返回简洁版' }).click()
  await page.getByRole('button', { name: '返回手机首页' }).click()
  await page.getByRole('link', { name: /^学习记录/ }).click()
  await auditVisibleUI(page, info, 'history-populated')
  if (info.project.name.startsWith('desktop')) {
    await page.goto(uiPath('/error-book'))
    await page.getByRole('button', { name: '查看错词：cancel', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '错词详情', exact: true })).toBeVisible()
    await auditVisibleUI(page, info, 'error-word-detail')
    await page.getByRole('button', { name: '关闭错词详情', exact: true }).click()
    await auditVisibleUI(page, info, 'error-book-populated')
  }
  await page.goto(uiPath('/mobile/library'))
  await page.getByRole('searchbox').fill('找不到的词库-UI-check')
  await auditVisibleUI(page, info, 'library-empty-search')
})

test('short landscape, enlarged text and keyboard focus retain explicit exits', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('phone'), 'Phone-specific rotation and text scaling.')
  await page.goto(uiPath('/mobile/settings'))
  await page.setViewportSize({ width: 844, height: 390 })
  await page.getByLabel('每日新词目标').fill('18')
  const save = page.getByRole('button', { name: '保存设置', exact: true })
  await expect(save).toBeInViewport()
  await save.focus()
  await expect(save).toBeFocused()
  await auditVisibleUI(page, info, 'settings-short-landscape-focus')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toContainText('设置已保存在本机')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await auditVisibleUI(page, info, 'settings-large-text')
  await save.click()
  await page.getByRole('link', { name: '返回首页', exact: true }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await auditVisibleUI(page, info, 'home-large-text')
})

test('settlement error offers a visible retry and completion offers a visible exit', async ({ page }, info) => {
  await seedReviewSession(page, reviewWords.slice(0, 1), 981002)
  await page.goto(uiPath('/mobile/study'))
  const card = page.locator('[data-mobile-word-practice]')
  await expect(card).toBeVisible()
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    ;(window as any).__restoreUIAuditWrite = () => {
      Storage.prototype.setItem = original
    }
    Storage.prototype.setItem = function (key, value) {
      if (key === 'qwerty.learn.dailySession.v1.cet4') throw new DOMException('UI audit storage failure', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await chooseLearnInputMode(page, 'keyboard')
  const field = card.getByRole('textbox', { name: '独立拼写单词' })
  await field.fill((await card.getAttribute('data-mobile-word'))!)
  await card.getByRole('button', { name: /^确认拼写/ }).click()
  await expect(page.locator('[data-mobile-complete]')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('学习记录还未确认完整保存')
  await auditVisibleUI(page, info, 'settlement-write-error')
  const retry = page.getByRole('button', { name: '重试保存', exact: true })
  await expect(retry).toBeInViewport()
  await page.evaluate(() => (window as any).__restoreUIAuditWrite())
  await retry.click()
  await expect(page.getByRole('status').filter({ hasText: '本轮学习记录已保存在本机' })).toBeVisible()
  await auditVisibleUI(page, info, 'settlement-complete')
  await page.getByRole('button', { name: '返回手机菜单', exact: true }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
})

test('a route render crash presents recovery actions and preserves the learning checkpoint', async ({ page }, info) => {
  await seedAcquisitionSession(page, reviewWords, 981003, 'exposure')
  await page.goto(uiPath('/mobile/study'))
  await expect(page.locator('[data-mobile-word-practice]')).toBeVisible()
  const checkpoint = await page.evaluate(() => localStorage.getItem('reviewModeInfo'))
  const chunk = readdirSync('build/assets').filter(
    (file) => file.endsWith('.js') && readFileSync('build/assets/' + file, 'utf8').includes('data-mobile-history'),
  )
  expect(chunk).toHaveLength(1)
  const fault = 'UI audit injected route render failure'
  await page.route('**/assets/' + chunk[0], (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'export default function BrokenHistory(){throw new Error(' + JSON.stringify(fault) + ')}',
    }),
  )
  await page.goto(uiPath('/mobile/history'))
  await expect(page.getByRole('heading', { name: '页面暂时无法显示', exact: true })).toBeVisible()
  await auditVisibleUI(page, info, 'render-failure-recovery', fault)
  expect(await page.evaluate(() => localStorage.getItem('reviewModeInfo'))).toBe(checkpoint)
  await page.getByRole('link', { name: '返回首页', exact: true }).click()
  await expect(page.locator('[data-mobile-menu], .focus-app-shell')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('reviewModeInfo'))).toBe(checkpoint)
})

test('user guide stays readable and returns without learning or network side effects', async ({ page }, info) => {
  const desktop = info.project.name.startsWith('desktop')
  const requests: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.includes('/api/')) requests.push(request.method() + ' ' + new URL(request.url()).pathname) })
  await page.goto(uiPath(desktop ? '/learn' : '/mobile'))
  const entry = desktop ? page.locator('[data-guide-entry="toolbar"]') : page.getByRole('link', { name: /^使用指南/ })
  await expect(entry).toBeVisible()
  const before = await readGuideLearningState(page)
  await entry.click()
  await expect(page.locator('[data-user-guide]')).toBeVisible()
  if (desktop) await expect(page.getByRole('dialog', { name: '使用指南', exact: true })).toBeVisible()
  if (desktop) {
    for (const key of ['Shift+Tab', 'Tab', 'Tab', 'Tab']) {
      await page.keyboard.press(key)
      await expect.poll(() => page.getByRole('dialog', { name: '使用指南', exact: true }).evaluate(node => node.contains(document.activeElement))).toBe(true)
    }
  }
  await expect(page.getByRole('button', { name: desktop ? '电脑练习' : '手机学习', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-guide-preview]')).toHaveCount(pagesUI ? 1 : 0)
  await auditVisibleUI(page, info, 'guide-start')
  for (const section of ['practice', 'learning', 'records', 'settings']) {
    const first = page.locator('[data-guide-section="' + section + '"] details').first()
    await first.locator('summary').click()
    await expect(first).toHaveAttribute('open', '')
    await auditVisibleUI(page, info, 'guide-' + section + '-expanded')
  }
  await page.getByRole('button', { name: desktop ? '手机学习' : '电脑练习', exact: true }).click()
  await expect(page.getByRole('button', { name: desktop ? '手机学习' : '电脑练习', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('a')
  await page.keyboard.press('Enter')
  expect(await readGuideLearningState(page)).toBe(before)
  if (desktop) {
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '使用指南', exact: true })).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(uiPath('/learn') + '$'))
  } else {
    await page.getByRole('button', { name: '返回首页', exact: true }).first().click()
    await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  }
  expect(await readGuideLearningState(page)).toBe(before)
  if (pagesUI) expect(requests).toEqual([])

  // Contextual help opens the relevant question and has an explicit return.
  if (desktop) {
    await page.getByRole('button', { name: '打开设置对话框' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '使用指南', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '使用指南', exact: true })).toBeVisible()
    await expect(page.locator('[data-guide-section="settings"] details').first()).toHaveAttribute('open', '')
    await page.getByRole('dialog', { name: '使用指南', exact: true }).getByRole('button', { name: '返回', exact: true }).click()
  } else {
    await page.getByRole('link', { name: /^设置/ }).click()
    await page.getByRole('link', { name: '查看使用指南', exact: true }).click()
    await expect(page.locator('[data-guide-section="settings"] details').first()).toHaveAttribute('open', '')
    await page.getByRole('button', { name: '返回设置', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: '学习设置', exact: true })).toBeVisible()
  }
  expect(await readGuideLearningState(page)).toBe(before)
  if (pagesUI) expect(requests).toEqual([])
  // Direct guide links and reloads have a valid return even without route state.
  await page.goto(uiPath(desktop ? '/guide#records' : '/mobile/guide#records'))
  await expect(page.locator('[data-guide-section="records"] details').first()).toHaveAttribute('open', '')
  await page.reload()
  await expect(page.locator('[data-user-guide]')).toBeVisible()
  await expect(page.locator('[data-guide-section="records"] details').first()).toHaveAttribute('open', '')
  expect(await readGuideLearningState(page)).toBe(before)
  await page.getByRole('button', { name: desktop ? '回到学习' : '返回首页', exact: true }).first().click()
  await expect(page).toHaveURL(new RegExp(uiPath(desktop ? '/learn' : '/mobile') + '$'))
  if (pagesUI) expect(requests).toEqual([])
})

test('desktop user guide preserves the active word and isolates practice keys', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'Keyboard learning uses the desktop shell.')
  await page.goto(uiPath('/learn'))
  await expect(page.getByRole('button', { name: '开始 Learn', exact: true })).toBeEnabled()
  await page.keyboard.press('a')
  const word = page.locator('[data-typing-word]:visible').first()
  await expect(word).toHaveAttribute('data-typing-active', 'true', { timeout: 30_000 })
  const spelling = await word.getAttribute('data-typing-word')
  const before = JSON.parse(await readGuideLearningState(page))
  await page.locator('[data-guide-entry="toolbar"]').click()
  const dialog = page.getByRole('dialog', { name: '使用指南', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '电脑练习', exact: true }).click()
  await page.keyboard.type(spelling!)
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await auditVisibleUI(page, info, 'guide-active-word')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(word).toHaveAttribute('data-typing-word', spelling!)
  const after = JSON.parse(await readGuideLearningState(page))
  expect(after.rows).toEqual(before.rows)
  const oldReview = JSON.parse(Object.fromEntries(before.storage).reviewModeInfo).reviewRecord
  const newReview = JSON.parse(Object.fromEntries(after.storage).reviewModeInfo).reviewRecord
  expect(newReview.index).toBe(oldReview.index)
  expect(newReview.words).toEqual(oldReview.words)
  await page.keyboard.press('Enter')
  await expect(word).toHaveAttribute('data-typing-active', 'true')
  await expect(word).toHaveAttribute('data-typing-word', spelling!)
})
