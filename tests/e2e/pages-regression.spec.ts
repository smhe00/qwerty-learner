import { expect, test } from '@playwright/test'

const site = 'https://smhe00.github.io/qwerty-learner/'
const targetSha = process.env.PAGES_SOURCE_SHA
if (!targetSha || !/^[a-f0-9]{40}$/.test(targetSha)) throw new Error('Missing verified Pages source SHA')

test('published Pages: matching SHA, cloud disabled, Learn route and reload durability', async ({ page, request }) => {
  test.setTimeout(120_000)
  await expect.poll(async () => {
    const result = await request.get(site + 'source-commit.txt', { failOnStatusCode: false })
    return result.ok() ? (await result.text()).trim() : ''
  }, { timeout: 90000, intervals: [1000, 2000, 5000] }).toBe(targetSha)
  await page.goto(site, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/qwerty-learner\/learn\/?$/)
  const original = new URL(page.url())
  for (let step = 0; step < 4; step++) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(original.pathname)
    expect(new URL(page.url()).search).toBe(original.search)
    expect(page.url()).not.toContain('~and~')
  }
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
  // P1 removes the entire cloud account/sync section in Pages builds.
  // Verify local backup remains available and cloud actions are absent.
  await expect(page.getByText('本地备份', { exact: true })).toBeVisible()
  await expect(page.getByText('云端同步与账号', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0)
})
