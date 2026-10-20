import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

test('Mobile uses an independent menu and hides the desktop Typing switcher', async ({ page }) => {
  await page.goto('/mobile')
  const menu = page.locator('[data-mobile-menu]')
  await expect(menu).toBeVisible({ timeout: 25_000 })
  await expect(menu.getByRole('heading', { name: /QWERTY/ })).toBeVisible()
  await expect(menu.getByRole('link', { name: '开始手机学习' })).toBeVisible()
  await expect(menu.getByText('账号与云同步', { exact: true })).toBeVisible()
  await expect(menu.getByText('设置', { exact: true })).toBeVisible()
  await expect(menu.getByText('即将开放', { exact: true })).toHaveCount(5)
  await expect(page.locator('header nav.focus-header-nav')).toHaveCount(0)
  const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(bounds.width).toBeLessThanOrEqual(bounds.viewport + 1)
})

test('Mobile Learn runs real keyboard-free tasks and persists a deliberate response', async ({ page }) => {
  await page.goto('/mobile/study')
  await expect(page.locator('[data-mobile-word-practice]')).toBeVisible({ timeout: 45_000 })
  await expect(page.locator('input, textarea, [data-typing-input-control]')).toHaveCount(0)
  await expect(page.locator('[data-mode-option="typing"]')).toHaveCount(0)

  const before = await page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<number>((resolve, reject) => {
        const count = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').count()
        count.onsuccess = () => resolve(count.result)
        count.onerror = () => reject(count.error)
      })
    } finally { db.close() }
  })

  const task = await page.locator('[data-mobile-word-practice]').getAttribute('data-mobile-task')
  if (task === 'exposure') {
    await page.getByRole('button', { name: '我看好了，继续' }).click()
  } else if (task === 'recall') {
    await page.getByRole('button', { name: '记得' }).click()
  } else {
    if (task === 'audio') {
      await page.getByRole('button', { name: /播放目标单词发音|重试发音/ }).click()
    }
    await page.locator('[data-mobile-choice]').first().click()
    await page.getByRole('button', { name: '确认选择' }).click()
  }

  await expect(page.locator('[data-mobile-feedback]')).toBeVisible()
  const after = await page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<number>((resolve, reject) => {
        const count = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').count()
        count.onsuccess = () => resolve(count.result)
        count.onerror = () => reject(count.error)
      })
    } finally { db.close() }
  })
  expect(after).toBeGreaterThan(before)

  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.locator('[data-mobile-word-practice], [data-mobile-complete]')).toBeVisible()
})

test('Mobile Learn can pause and resume without exposing a keyboard', async ({ page }) => {
  await page.goto('/mobile/study')
  await expect(page.locator('[data-mobile-word-practice]')).toBeVisible({ timeout: 45_000 })
  await page.getByRole('button', { name: '暂停学习' }).click()
  await expect(page.locator('[data-mobile-paused]')).toBeVisible()
  await expect(page.locator('input, textarea, [data-typing-input-control]')).toHaveCount(0)
  await page.getByRole('button', { name: '继续学习' }).click()
  await expect(page.locator('[data-mobile-paused]')).toHaveCount(0)
  await expect(page.locator('[data-mobile-word-practice]')).toBeVisible()
})
