import { expect, test } from '@playwright/test'

test('production build resolves lazy navigation and preserves Learn session on reload', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/typing')

  await page
    .getByRole('link', { name: '沪教新初2027', exact: true })
    .click()
  await expect(page).toHaveURL(/\/gallery/)
  await expect(
    page.getByText('沪教新初2027', { exact: true }).first(),
  ).toBeVisible()

  await page.goto('/analysis?from=learn')
  await expect(page.locator('[data-fsrs-shadow-analysis]')).toBeVisible()
  await expect(page.getByText('FSRS-6 Shadow 分析')).toBeVisible()

  await page.goto('/typing')
  await page.getByRole('button', {
    name: '查看数据统计',
    exact: true,
  }).click()
  await expect(page).toHaveURL(/\/analysis$/)
  await page.getByRole('button', { name: '返回', exact: true }).click()

  await page.goto('/typing')
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/learn\/session$/)
  await expect(page.getByText('按任意键开始')).toBeVisible()

  const before = await page.evaluate(() => {
    const raw = localStorage.getItem('reviewModeInfo')
    return raw ? JSON.parse(raw) : undefined
  })

  await page.reload()
  await expect(page).toHaveURL(/\/learn\/session$/)

  await expect(page.getByText('按任意键开始')).toBeVisible()

  const after = await page.evaluate(() => {
    const raw = localStorage.getItem('reviewModeInfo')
    return raw ? JSON.parse(raw) : undefined
  })

  expect(after?.reviewRecord?.id ?? after?.reviewRecord?.createTime).toBe(
    before?.reviewRecord?.id ?? before?.reviewRecord?.createTime,
  )
  expect(pageErrors).toEqual([])
})


test('fresh browser boots with 沪教新初2027 as the default dictionary', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/typing')

  await expect(
    page.getByRole('link', { name: '沪教新初2027', exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-typing-word="life"]')).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('stale chapter from a larger dictionary self-heals without a blank page', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.addInitScript(() => {
    localStorage.removeItem('currentDict')
    localStorage.setItem('currentChapter', JSON.stringify(999))
  })

  await page.goto('/typing')

  await expect(
    page.getByRole('link', { name: '沪教新初2027', exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-typing-word="life"]')).toBeVisible()

  await expect
    .poll(async () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('currentChapter') || 'null'),
      ),
    )
    .toBe(0)

  expect(pageErrors).toEqual([])
})
