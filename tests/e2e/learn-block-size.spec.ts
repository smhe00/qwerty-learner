import { test, expect } from '@playwright/test'
import { gotoReviewAppReady, readReviewModeInfo, waitForActiveLearnSession } from './review-flow-harness'

for (const blockSize of [5, 50]) {
  test(`memory setting persists ${blockSize} and creates a matching Learn block`, async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('block-size-seed')) return
      sessionStorage.setItem('block-size-seed', 'done')
      localStorage.setItem('memoryConfig', JSON.stringify({ dailyNewWordTarget: 50 }))
    })
    await gotoReviewAppReady(page)
    await page.getByTitle('打开设置对话框').click()
    await page.getByRole('tab', { name: '记忆参数' }).click()
    const control = page.getByRole('spinbutton', { name: '每阶段词数' })
    await expect(control).toHaveValue('20')
    await expect(control).toHaveAttribute('min', '5')
    await expect(control).toHaveAttribute('max', '50')
    await control.fill('2')
    await expect(control).toHaveValue('5')
    await control.fill('60')
    await expect(control).toHaveValue('50')
    await control.fill(String(blockSize))
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('memoryConfig')!).blockSize)).toBe(blockSize)
    await page.reload()
    await page.getByTitle('打开设置对话框').click()
    await page.getByRole('tab', { name: '记忆参数' }).click()
    await expect(control).toHaveValue(String(blockSize))
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    const info = await waitForActiveLearnSession(page)
    expect(info.reviewRecord.blockSize).toBe(blockSize)
    expect(new Set(info.reviewRecord.words.map((word: { name: string }) => word.name)).size).toBe(blockSize)
    const id = info.reviewRecord.id
    await page.getByTitle('打开设置对话框').click()
    await page.getByRole('tab', { name: '记忆参数' }).click()
    await control.fill(String(blockSize === 50 ? 5 : 50))
    await page.keyboard.press('Escape')
    await page.reload()
    const restored = await waitForActiveLearnSession(page)
    expect(restored.reviewRecord.id).toBe(id)
    expect(restored.reviewRecord.words.length).toBe(blockSize)
  })
}
