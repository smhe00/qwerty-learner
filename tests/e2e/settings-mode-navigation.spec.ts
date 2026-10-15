import { expect, test, type Page } from '@playwright/test'

async function openSettings(page: Page) {
  const open = page.getByRole('button', { name: '打开设置对话框' })
  await expect(open).toBeVisible({ timeout: 30_000 })
  await open.click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test('Learn opens its learning plan; Typing preferences are separately reachable', async ({ page }) => {
  await page.goto('/learn')
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
  await page.goto('/typing')
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
  await page.goto('/learn')
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.dispatchEvent(new Event('qwerty:open-data-settings')))
  await expect(page.getByRole('tab', { name: '数据与备份' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('本地备份', { exact: true })).toBeVisible()
})
