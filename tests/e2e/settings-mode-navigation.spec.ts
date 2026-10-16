import { gotoReviewAppReady } from './review-flow-harness'
import { expect, test, type Page } from '@playwright/test'

async function openSettings(page: Page) {
  const open = page.getByRole('button', { name: '打开设置对话框' })
  await expect(open).toBeVisible({ timeout: 30_000 })
  await open.click()
  const diag = await page.evaluate(() => {
    const btn = document.querySelector<HTMLButtonElement>('button[aria-label="打开设置对话框"]')
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]')
    const active = document.activeElement as HTMLElement | null
    const walk = (node: HTMLElement | null) => {
      const ancestors: string[] = []
      for (let el = node, depth = 0; el && depth < 6; el = el.parentElement, depth++) {
        const style = getComputedStyle(el)
        const box = el.getBoundingClientRect()
        ancestors.push([el.tagName, el.className?.toString().slice(0, 85),
          'display=' + style.display, 'visibility=' + style.visibility,
          'opacity=' + style.opacity, 'rect=' + box.width + 'x' + box.height].join(' '))
      }
      return ancestors
    }
    return { buttonActive: btn?.getAttribute('data-toolbar-active'),
      button: walk(btn), dialog: walk(dlg), active: active?.outerHTML.slice(0, 200),
      modalCount: document.querySelectorAll('[role="dialog"]').length }
  })
  console.log('SETTINGS_POINTER_DIAG', JSON.stringify(diag))
  await expect(page.getByRole('dialog')).toBeVisible()
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

test('compact settings navigation is horizontal and preserves access to all sections', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await gotoReviewAppReady(page, '/')
  await openSettings(page)
  await expect(page.getByRole('tablist')).toHaveAttribute('aria-orientation', 'horizontal')
  const dataTab = page.getByRole('tab', { name: '数据与备份' })
  await dataTab.click()
  await expect(dataTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('本地备份', { exact: true })).toBeVisible()
  const sizes = await page.getByRole('dialog').evaluate(el => ({
    width: el.clientWidth, documentWidth: el.scrollWidth,
  }))
  expect(sizes.documentWidth).toBeLessThanOrEqual(sizes.width + 1)
})
