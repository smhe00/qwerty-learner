import { expect, test } from '@playwright/test'

test('Formal release: title, social metadata, visible footer and donation omit prerelease labels', async ({ page }) => {
  await page.goto('/learn')
  // The first S1 bootstrap may replace the initial document. Wait until the
  // real study shell is mounted before asserting its footer and donate dialog.
  await expect(page.getByRole('button', { name: '打开赞赏页面' })).toBeVisible({ timeout: 30000 })
  await expect(page).toHaveTitle(/QWERTY Plus.*Typing.*Learn/)
  const title = await page.title()
  expect(title).not.toMatch(/alpha|beta/i)
  for (const selector of [
    'meta[name="description"]',
    'meta[property="og:title"]',
    'meta[property="og:description"]',
    'meta[property="twitter:title"]',
    'meta[property="twitter:description"]',
  ]) {
    const content = await page.locator(selector).getAttribute('content')
    expect(content, selector).toBeTruthy()
    expect(content, selector).not.toMatch(/alpha|beta/i)
  }
  const footer = page.locator('footer.focus-footer')
  await expect(footer).toContainText('QWERTY Plus', { timeout: 20000 })
  await expect(footer).not.toContainText(/alpha|beta/i)
  await page.getByRole('button', { name: '打开赞赏页面' }).click()
  await expect(page.getByText('Qwerty Plus · 打字与长期记忆学习。')).toBeVisible()
  await expect(page.getByRole('dialog')).not.toContainText(/alpha|beta/i)
})

test('Formal mobile home exposes learning without prerelease branding', async ({ page }) => {
  await page.goto('/mobile')
  await expect(page.getByRole('button', { name: /开始学习|继续学习/ })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/alpha|beta/i)
})
