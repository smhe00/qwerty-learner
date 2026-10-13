import { gotoReviewAppReady } from './review-flow-harness'
import { expect, test } from '@playwright/test'

test('fresh profile keeps Shanghai Zhongkao 2027 and only two classification controls', async ({ page }) => {
  await gotoReviewAppReady(page, '/typing')
  await expect(page.getByRole('link', { name: '上海中考2027', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '上海中考2027', exact: true }).click()
  const catalog = page.locator('[data-dictionary-catalog]')
  await expect(catalog.getByRole('radiogroup')).toHaveCount(2)
  await expect(catalog.getByRole('radio', { name: '英语', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(catalog.getByRole('radio', { name: '初中与中考', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(catalog.getByRole('radio', { name: /日语|德语|哈萨克|印尼/ })).toHaveCount(0)
  await expect(catalog.getByRole('button', { name: /上海中考2027/ })).toBeVisible()
})

test('computing classification includes English terms and resets search when switching domains', async ({ page }) => {
  await page.goto('/gallery')
  const catalog = page.locator('[data-dictionary-catalog]')
  await catalog.getByRole('radio', { name: '计算机与编程', exact: true }).click()
  await expect(catalog.getByRole('button', { name: /计算机专用英语/ })).toBeVisible()
  await expect(catalog.getByRole('button', { name: /Coder Dict/ })).toBeVisible()
  await catalog.getByRole('radio', { name: 'Python', exact: true }).click()
  await expect(catalog.getByRole('button', { name: /Python: Built-in/ })).toBeVisible()
  await expect(catalog.getByRole('button', { name: /少儿 Python/ })).toHaveCount(0)
  await catalog.getByRole('searchbox').fill('no such dictionary')
  await expect(catalog.getByText('没有匹配的词典，请尝试其他关键词。')).toBeVisible()
  await catalog.getByRole('radio', { name: '英语', exact: true }).click()
  await expect(catalog.getByRole('searchbox')).toHaveValue('')
  await expect(catalog.getByRole('button', { name: /上海中考2027/ })).toBeVisible()
  await expect(catalog.getByRole('radiogroup')).toHaveCount(2)
})

test('Typing still selects a chapter and persists its original dictionary ID', async ({ page }) => {
  await page.goto('/gallery')
  const catalog = page.locator('[data-dictionary-catalog]')
  await catalog.getByRole('radio', { name: '大学与四六级', exact: true }).click()
  await catalog.getByRole('button', { name: /六级巧记速记/ }).click()
  await page.getByRole('heading', { name: '第 2 章', exact: true }).click()
  await expect(page).toHaveURL(/\/typing$/)
  await expect(page.getByRole('button', { name: '第 2 章', exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('currentDict') || 'null'))).toBe('xinghuoqiaoji_6')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('currentChapter') || 'null'))).toBe(1)
})

test('Learn selects a whole dictionary by keyboard without a chapter dialog', async ({ page }) => {
  await page.goto('/gallery?mode=learn')
  const catalog = page.locator('[data-dictionary-catalog]')
  await catalog.getByRole('radio', { name: '大学与四六级', exact: true }).click()
  await catalog.getByRole('button', { name: '选择 Learn 词库：CET-4', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/learn$/)
  await expect(page.getByRole('link', { name: 'CET-4', exact: true })).toBeVisible()
  await expect(page.getByText('章节选择', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('currentDict') || 'null'))).toBe('cet4')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('currentChapter') || 'null'))).toBe(0)
})

test('browsing hides legacy language courses without changing their current ID, chapter or records', async ({ page }) => {
  await gotoReviewAppReady(page, '/typing')
  await page.evaluate(() => {
    localStorage.setItem('currentDict', JSON.stringify('en2german'))
    localStorage.setItem('currentChapter', JSON.stringify(2))
  })
  await page.addScriptTag({
    type: 'module',
    content:
      "import { db } from '/src/utils/db/core.ts'; await db.wordRecords.add({dict:'en2german',word:'catalog-preserved',timeStamp:123,wrongCount:0}); window.__catalogSeeded = true",
  })
  await expect.poll(() => page.evaluate(() => (window as Window & { __catalogSeeded?: boolean }).__catalogSeeded)).toBe(true)
  await page.goto('/gallery')
  const catalog = page.locator('[data-dictionary-catalog]')
  await expect(catalog.getByRole('radio', { name: '英语', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(catalog.getByRole('button', { name: /英语 德译/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/typing$/)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('currentDict') || 'null'))).toBe('en2german')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('currentChapter') || 'null'))).toBe(2)
  await page.addScriptTag({
    type: 'module',
    content:
      "import { db } from '/src/utils/db/core.ts'; window.__catalogRows = await db.wordRecords.where('dict').equals('en2german').toArray()",
  })
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __catalogRows?: unknown[] }).__catalogRows))
    .toEqual([expect.objectContaining({ dict: 'en2german', word: 'catalog-preserved', timeStamp: 123, wrongCount: 0 })])
})

for (const width of [640, 1024, 1440]) {
  test('catalog wraps without horizontal overflow at width ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/gallery')
    const catalog = page.locator('[data-dictionary-catalog]')
    await expect(catalog).toBeVisible()
    await catalog.getByRole('radio', { name: '雅思', exact: true }).click()
    await expect(catalog.getByRole('button').first()).toBeVisible()
    const sizes = await catalog.evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }))
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1)
    await page.screenshot({ path: 'test-results/dictionary-catalog-' + width + '.png' })
  })
}

test('merged general vocabulary renders legacy duplicate IDs without React key warnings', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/gallery')
  const catalog = page.locator('[data-dictionary-catalog]')
  await catalog.getByRole('radio', { name: '通用与高频词汇', exact: true }).click()
  await catalog.getByRole('searchbox').fill('牛津5000')
  await expect(catalog.getByRole('button', { name: /牛津5000词/ })).toHaveCount(2)
  expect(errors.filter((message) => /same key|unique.*key/i.test(message))).toEqual([])
})
