import { gotoReviewAppReady } from './review-flow-harness'
import { expect, test, type Page } from '@playwright/test'

async function openSettings(page: Page) {
  const open = page.getByRole('button', { name: '打开设置对话框' })
  await expect(open).toBeVisible({ timeout: 30_000 })
  await open.click()
  // The accessible role=dialog wrapper contains fixed-position children and
  // has zero own height. Assert the actual visible dialog panel instead.
  await expect(page.locator('.focus-overlay-panel')).toBeVisible()
}

test('Learn opens its learning plan; Typing preferences are separately reachable', async ({ page }) => {
  await gotoReviewAppReady(page, '/')
  await openSettings(page)
  await expect(page.getByRole('tab', { name: '学习计划' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-settings-scope="learn"]')).toBeVisible()
  await expect(page.getByLabel('每日新词目标')).toBeVisible()
  await page.getByRole('tab', { name: '打字练习' }).click()
  await expect(page.locator('[data-settings-scope="typing"]')).toBeVisible()
  await expect(page.getByText('章节乱序')).toBeVisible()
  await expect(page).toHaveURL(/\/learn$/)
  await page.getByRole('button', { name: '关闭设置' }).click()
  await openSettings(page)
  await expect(page.getByRole('tab', { name: '学习计划' })).toHaveAttribute('aria-selected', 'true')
})

test('Typing opens its own preferences; shared appearance retains text-selection control', async ({ page }) => {
  await gotoReviewAppReady(page, '/typing')
  await openSettings(page)
  await expect(page.getByRole('tab', { name: '打字练习' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-settings-scope="typing"]')).toBeVisible()
  await page.getByRole('tab', { name: '外观显示' }).click()
  await expect(page.locator('[data-settings-scope="shared"]')).toBeVisible()
  const textSelect = page.getByRole('switch', { name: '允许选择练习文本' })
  await expect(textSelect).toBeVisible()
  const wasChecked = await textSelect.getAttribute('aria-checked')
  await textSelect.click()
  await expect(textSelect).toHaveAttribute('aria-checked', wasChecked === 'true' ? 'false' : 'true')
  await expect(page).toHaveURL(/\/typing$/)
})

test('external data-settings shortcut still opens Data & Backup even in Learn mode', async ({ page }) => {
  await gotoReviewAppReady(page, '/')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.dispatchEvent(new Event('qwerty:open-data-settings')))
  await expect(page.getByRole('tab', { name: '数据与备份' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('本地备份', { exact: true })).toBeVisible()
})

test('fresh workspace uses British voice, 20 new words and 10 per stage with minimum 1', async ({ page }) => {
  await gotoReviewAppReady(page, '/typing')
  await expect(page.getByRole('button', { name: '发音及音标切换：英音' })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('qwerty:open-data-settings')))
  await page.getByRole('tab', { name: '学习计划' }).click()
  await expect(page.getByRole('spinbutton', { name: '每日新词目标' })).toHaveValue('20')
  const stage = page.getByRole('spinbutton', { name: '每阶段词数' })
  await expect(stage).toHaveValue('10')
  await expect(stage).toHaveAttribute('min', '1')
  await stage.fill('1')
  await stage.blur()
  await expect(stage).toHaveValue('1')
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('memoryConfig')!).blockSize)).toBe(1)
})

test('saved American voice and custom daily/stage preferences survive new defaults', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('stored-settings-seeded')) return
    sessionStorage.setItem('stored-settings-seeded', 'yes')
    localStorage.setItem('pronunciation', JSON.stringify({
      isOpen: true, volume: 1, type: 'us', name: '美音',
      isLoop: false, isTransRead: false, transVolume: 1, rate: 1,
    }))
    localStorage.setItem('memoryConfig', JSON.stringify({ dailyNewWordTarget: 37, blockSize: 7 }))
  })
  await gotoReviewAppReady(page, '/typing')
  await expect(page.getByRole('button', { name: '发音及音标切换：美音' })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('qwerty:open-data-settings')))
  await page.getByRole('tab', { name: '学习计划' }).click()
  await expect(page.getByRole('spinbutton', { name: '每日新词目标' })).toHaveValue('37')
  await expect(page.getByRole('spinbutton', { name: '每阶段词数' })).toHaveValue('7')
})

test('small-screen visitors enter the independent Mobile P0 menu', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/learn')
  await expect(page).toHaveURL(/\/mobile\/?$/)
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await expect(page.getByRole('link', { name: /^(开始|继续)手机学习$/ })).toBeVisible()
  await expect(page.getByText('设置', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
})

for (const theme of ['light', 'dark'] as const) {
  test(`settings ${theme} palette uses Focus accent for selected tab, switch and slider`, async ({ page }) => {
    await gotoReviewAppReady(page, '/typing')
    const darkButton = page.getByRole('button', { name: '开关深色模式' })
    const isDark = () => page.locator('html').evaluate(el => el.classList.contains('dark'))
    if ((await isDark()) !== (theme === 'dark')) await darkButton.click()
    await expect.poll(isDark).toBe(theme === 'dark')
    await openSettings(page)

    const panel = page.locator('.focus-settings-dialog')
    const current = page.getByRole('tab', { name: '打字练习' })
    await expect(current).toHaveAttribute('aria-selected', 'true')

    const tabColors = await current.evaluate(el => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--focus-accent)'
      el.appendChild(probe)
      const accent = getComputedStyle(probe).color
      probe.remove()
      return { accent, selected: getComputedStyle(el).color }
    })
    expect(tabColors.selected).toBe(tabColors.accent)

    const checkedSwitch = panel.locator('.switch-root[aria-checked="true"]').first()
    await expect(checkedSwitch).toBeVisible()
    const switchColor = await checkedSwitch.evaluate(el => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--focus-accent)'
      el.appendChild(probe)
      const accent = getComputedStyle(probe).backgroundColor
      probe.remove()
      return { accent, checked: getComputedStyle(el).backgroundColor }
    })
    expect(switchColor.checked).toBe(switchColor.accent)

    await page.getByRole('tab', { name: '外观显示' }).click()
    const range = panel.locator('.slider > span:nth-child(1) > span:nth-child(1)').first()
    await expect(range).toBeVisible()
    const rangeColor = await range.evaluate(el => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--focus-accent)'
      el.appendChild(probe)
      const accent = getComputedStyle(probe).backgroundColor
      probe.remove()
      return { accent, range: getComputedStyle(el).backgroundColor }
    })
    expect(rangeColor.range).toBe(rangeColor.accent)
  })
}
