import { expect, test } from '@playwright/test'
import { gotoReviewAppReady, readReviewModeInfo, startTyping, waitForActiveLearnSession } from './review-flow-harness'

for (const entry of ['result', 'landing'] as const) {
test(`optional tail words never block daily completion; ${entry} five-more extends today and survives reload`, async ({ page }) => {
  test.setTimeout(90000)
  await page.addInitScript(() => {
    if (sessionStorage.getItem('extra-words-seeded')) return
    sessionStorage.setItem('extra-words-seeded', 'yes')
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('memoryConfig', JSON.stringify({ dailyNewWordTarget: 1, blockSize: 20 }))
  })
  await gotoReviewAppReady(page)
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await waitForActiveLearnSession(page)
  await startTyping(page)
  let sawOptional = false
  let refreshedOptional = false
  for (let step = 0; step < 30; step++) {
    if (await page.locator('[data-learn-daily-complete]').count()) break
    const info = await readReviewModeInfo(page)
    const rec = info.reviewRecord
    const name = rec.words[rec.index].name
    const phase = rec.acquisitionStates[name]?.phase
    const planned = await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4')!).plannedNewWordNames)
    if (!planned.includes(name)) {
      sawOptional = true
      if (!refreshedOptional) {
        refreshedOptional = true
        await page.reload()
        const restored = await waitForActiveLearnSession(page)
        expect(restored.reviewRecord.id).toBe(rec.id)
        expect(restored.reviewRecord.words[restored.reviewRecord.index].name).toBe(name)
        expect(restored.reviewRecord.acquisitionStates[name].phase).toBe(phase)
        if (await page.getByText('按任意键开始').isVisible()) await startTyping(page)
      }
    }
    await expect(page.locator(`[data-typing-word="${name}"]`)).toBeVisible()
    await page.keyboard.type(name, { delay: 20 })
    await expect.poll(async () => {
      if (await page.locator('[data-learn-daily-complete]').count()) return true
      const next = (await readReviewModeInfo(page)).reviewRecord
      return next.index !== rec.index || next.acquisitionStates[name]?.phase !== phase || next.isFinished
    }).toBe(true)
  }
  await expect(page.locator('[data-learn-daily-complete]')).toBeVisible()
  expect(sawOptional).toBe(true)
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4')!))
  expect(before.plannedNewWords).toBe(1)
  const record = (await readReviewModeInfo(page)).reviewRecord
  expect(Object.values(record.acquisitionStates).some((state: any) => state.phase !== 'complete')).toBe(true)
  if (entry === 'landing') {
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await expect(page.getByRole('button', { name: '多学五词', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '开始 Learn', exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: '多学五词', exact: true })).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4')!).plannedNewWords)).toBe(1)
  }
  await page.getByRole('button', { name: '多学五词', exact: true }).click()
  await waitForActiveLearnSession(page)
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4')!))
  expect(after.plannedNewWords).toBe(6)
  expect(after.dailyNewTarget).toBe(1)
  expect(after.sessionId).toBe(before.sessionId)
  expect(after.completedBlockIds).toEqual(before.completedBlockIds)
  const admitted = after.plannedNewWordNames.slice(1)
  expect(admitted).toHaveLength(5)
  expect(admitted.every((name: string) => !Object.keys(record.acquisitionStates).includes(name))).toBe(true)
  await page.reload()
  await waitForActiveLearnSession(page)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4')!).plannedNewWords)).toBe(6)
})

}
