import { expect, test, type Page } from '@playwright/test'

async function openDeveloper(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '开发诊断' }).click()
  await expect(page.getByRole('heading', { name: '开发诊断' })).toBeVisible()
}

test('developer diagnostics matches simplified backup hierarchy, no competing primary actions', async ({ page }) => {
  await openDeveloper(page)
  await expect(page.getByRole('button', { name: '导出现场诊断包' })).toBeVisible()
  await expect(page.getByRole('button', { name: '导出事件记录' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: '清空事件记录' })).not.toBeVisible()
  await page.getByText(/管理事件记录/).click()
  await expect(page.getByRole('button', { name: '导出事件记录' })).toBeVisible()
  await expect(page.getByRole('button', { name: '清空事件记录' })).toBeVisible()
  await expect(page.getByText(/仅向可信开发者提供/)).toBeVisible()
})

test('development Trace switch and destructive clear confirmation preserve expected behavior', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('qwertyDeveloperTraceV1', JSON.stringify([
      { sequence:1, at:Date.now(), event:'test-dev' },
    ]))
  })
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '开发诊断' }).click()
  await expect(page.getByText('管理事件记录 · 1 条')).toBeVisible()
  const toggle=page.getByRole('switch', { name: '开发诊断 Trace' })
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(page.getByText('已开启')).toBeVisible()
  await toggle.click()
  await expect(page.getByText('已关闭')).toBeVisible()
  await page.getByText('管理事件记录 · 1 条').click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '清空事件记录' }).click()
  expect(await page.evaluate(() => localStorage.getItem('qwertyDeveloperTraceV1'))).not.toBeNull()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '清空事件记录' }).click()
  await expect(page.getByText('管理事件记录 · 0 条')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('qwertyDeveloperTraceV1'))).toBeNull()
})

test('developer heading is readable in dark theme', async ({ page }) => {
  await openDeveloper(page)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  const contrast = await page.evaluate(() => {
    const heading = document.querySelector('[aria-label="开发诊断"] h3')!
    const dialog = document.querySelector('[role="dialog"] .focus-overlay-panel')!
    const parse = (value: string) => (value.match(/[0-9]+/g)||[]).slice(0,3).map(Number)
    const luminance = (rgb: number[]) => rgb.map(n => {
      const x=n/255
      return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4
    }).reduce((s,x,i) => s+x*[0.2126,0.7152,0.0722][i],0)
    const a=luminance(parse(getComputedStyle(heading).color))
    const b=luminance(parse(getComputedStyle(dialog).backgroundColor))
    return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)
  })
  expect(contrast).toBeGreaterThan(4.5)
})
