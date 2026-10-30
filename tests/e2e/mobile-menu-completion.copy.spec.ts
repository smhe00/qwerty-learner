import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

async function home(page: Page) {
  await page.goto('/mobile')
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
}

async function evidence(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      const names = ['wordRecords', 'chapterRecords', 'reviewRecords', 'reviewWordStates', 'achievementEvents', 'achievementStates']
      const tx = db.transaction(names, 'readonly')
      const rows = await Promise.all(names.map(name => new Promise((resolve, reject) => {
        const read = tx.objectStore(name).getAll()
        read.onsuccess = () => resolve([name, read.result])
        read.onerror = () => reject(read.error)
      })))
      return { rows, dictionary: localStorage.getItem('currentDict'), checkpoint: localStorage.getItem('reviewModeInfo') }
    } finally { db.close() }
  })
}

async function screenshot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-polish-' + name + '.png' })
}

test('menu completion: home prioritizes actual progress and actions without repeated instruction copy', async ({ page }) => {
  await home(page)
  const menu = page.locator('[data-mobile-menu]')
  await expect(menu.getByRole('heading', { name: '今日学习', exact: true })).toBeVisible()
  await expect(menu.getByRole('link', { name: '开始手机学习', exact: true })).toHaveText('开始学习')
  await expect(menu.locator('.mobile-menu-item .mobile-menu-text strong')).toHaveText([
    '圈子', '成就', '词库', '学习记录', '账号与云同步', '设置', '使用指南', '反馈与建议',
  ])
  await expect(menu.getByRole('button', { name: '圈子（登录后可用）', exact: true })).toBeDisabled()
  await expect(menu.getByRole('button', { name: '反馈与建议', exact: true })).toBeVisible()
  await expect(menu.locator('.mobile-menu-text small')).toHaveText(['登录后使用', '登录后同步学习进度', '一分钟入门 · 随时查阅'])
  await expect(menu.getByText('登录后同步学习进度', { exact: true })).toBeVisible()
  await expect(menu.getByRole('progressbar', { name: '今日目标进度' })).toHaveAttribute('aria-valuenow', '0')
  await expect(menu).not.toContainText(/Beta|即将开放|轻触学习为主|TODAY · LEARN|练打字 · 记单词/)
  await expect(menu.locator('[data-mobile-checkpoint-status]')).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('qwerty.learn.dailySession.')))).toEqual([])
  await screenshot(page, 'home')
})

test('menu completion: concise subpages retain recovery disclosure and leave six-table evidence unchanged', async ({ page }) => {
  await home(page)
  await page.addScriptTag({ type: 'module', content: `
    import { db } from '/src/utils/db/core.ts';
    await db.wordRecords.add({dict:'cet4',word:'polish-fixture',chapter:-1,
      timeStamp:Math.floor(Date.now()/1000),timing:[300],wrongCount:0,
      mistakes:{},sourceMode:'learn',learnItemKind:'review'});
    window.__polishSeeded = true;
  ` })
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__polishSeeded))).toBe(true)
  const before = await evidence(page)
  for (const [name, path, heading] of [
    ['词库', 'library', '选择词库'],
    ['学习记录', 'history', '学习记录'],
    ['账号与云同步', 'data', '账号与云同步'],
  ]) {
    await page.getByRole('link', { name: new RegExp('^' + name) }).tap()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/查看你的学习记录。|保存学习记录和设置，便于恢复。|请妥善保存备份文件。|切换后，各词库的学习进度分别保留。/)
    if (path === 'library') {
      await expect(page.getByLabel('搜索词库')).toBeVisible()
      await expect(page.getByText(/^当前词库：/)).toBeVisible()
    }
    if (path === 'history') {
      await expect(page.locator('[data-history-attempts]')).toHaveText('1')
      await expect(page.locator('[data-history-reviews]')).toHaveText('1')
      await expect(page.locator('.mobile-history-definition')).not.toHaveAttribute('open', '')
    }
    if (path === 'data') {
      await expect(page.getByRole('button', { name: '立即同步', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '导出完整备份', exact: true })).toBeVisible()
      await page.locator('.mobile-data-restore summary').tap()
      await expect(page.locator('.mobile-data-restore')).toContainText('恢复会替换当前记录，不会合并')
      await expect(page.locator('.mobile-data-restore')).toContainText('下一步确认后才会恢复')
      await page.locator('.mobile-data-restore summary').tap()
    }
    await page.setViewportSize({ width: 320, height: 640 })
    await screenshot(page, path)
    await page.getByRole('link', { name: '返回首页', exact: true }).tap()
    await expect(page.locator('[data-mobile-menu]')).toBeVisible()
    expect(await evidence(page)).toEqual(before)
  }
})

test('menu completion: settings show actionable timing and real unsaved/saved feedback, not implementation prose', async ({ page }) => {
  await home(page)
  const before = await evidence(page)
  await page.getByRole('link', { name: /^设置/ }).tap()
  await expect(page.getByRole('heading', { name: '学习设置', exact: true })).toBeVisible()
  await expect(page.locator('.mobile-settings-saved')).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText(/手机与桌面界面共用|每天少量积累|查看学习历史，或核对同步状态/)
  await expect(page.locator('#mobile-daily-target-hint')).toContainText('今日计划已开始时，次日生效')
  await expect(page.locator('#mobile-block-size-hint')).toContainText('下一阶段生效')
  await page.getByLabel('每日新词目标').fill('17')
  await expect(page.locator('.mobile-settings-saved')).toContainText('未保存')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('link', { name: '查看学习记录', exact: true }).tap()
  await expect(page).toHaveURL(/\/mobile\/settings$/)
  await page.getByRole('button', { name: '保存设置', exact: true }).tap()
  await expect(page.locator('.mobile-settings-saved')).toContainText('设置已保存在本机')
  await page.reload()
  await expect(page.getByLabel('每日新词目标')).toHaveValue('17')
  await expect(page.locator('.mobile-settings-saved')).toHaveCount(0)
  await screenshot(page, 'settings')
  await page.getByLabel('深色模式').check()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await screenshot(page, 'settings-dark')
  expect(await evidence(page)).toEqual(before)
})
