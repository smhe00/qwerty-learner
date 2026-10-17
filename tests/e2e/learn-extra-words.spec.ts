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
  const unfinished = Object.entries(record.acquisitionStates).filter(([, state]: [string, any]) => state.phase !== 'complete').map(([name]) => name)
  expect(after.extraRoundWordNames).toHaveLength(5)
  expect(after.extraRoundWordNames.slice(0, unfinished.length)).toEqual(unfinished)
  expect(after.plannedNewWords).toBe(6 - unfinished.length)
  expect(after.dailyNewTarget).toBe(1)
  expect(after.sessionId).toBe(before.sessionId)
  expect(after.completedBlockIds).toEqual(before.completedBlockIds)
  const admitted = after.plannedNewWordNames.slice(1)
  expect(admitted).toHaveLength(5 - unfinished.length)
  expect(admitted.every((name: string) => !Object.keys(record.acquisitionStates).includes(name))).toBe(true)
  await page.reload()
  await waitForActiveLearnSession(page)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4')!).plannedNewWords)).toBe(after.plannedNewWords)
})

}


for (const legacyRound of [false, true]) {
test(`Continue resumes failed terminal acquisition without five-more${legacyRound ? '; ignores a legacy five-word boundary' : ''}`, async ({ page }) => {
  test.setTimeout(90000)
  await gotoReviewAppReady(page, '/typing')
  await page.evaluate(async (legacyRound) => {
    const now = Math.floor(Date.now() / 1000)
    const d = new Date()
    const dateKey = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('reviewModeInfo', JSON.stringify({ isReviewMode: false }))
    localStorage.setItem('qwerty.learn.dailySession.v1.cet4', JSON.stringify({ version: 1, sessionId: 'failed-terminal', dict: 'cet4', dateKey, startedAt: now - 60, status: 'active', executionExhausted: true, dailyNewTarget: 1, plannedNewWords: 1, plannedNewWordNames: ['cancel'], plannedReviewWords: [], carryOverAcquisitionWords: [], accumulatedActiveSeconds: 0, completedBlockIds: [], blockCount: 0, ...(legacyRound ? { extraRoundWordNames: ['analyse'], extraRoundStartedAt: now - 10 } : {}) }))
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('RecordDB')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['wordRecords', 'reviewRecords'], 'readwrite')
        tx.objectStore('wordRecords').add({ word: 'cancel', dict: 'cet4', chapter: -1, timeStamp: now - 50, sourceMode: 'learn', learnItemKind: 'acquisition', wrongCount: 0, timing: [], mistakes: {}, reviewPolicyDecision: { version: 1, policyVersion: 'learn-acquisition-exposure-v1', reasonCodes: ['visible-copy'], conditionVersion: 1 } })
        tx.objectStore('reviewRecords').add({ dict: 'cet4', createTime: now - 30, words: [{ name: 'cancel', trans: [], usphone: '', ukphone: '' }], index: 1, isFinished: true, sessionKind: 'acquisition', acquisitionStates: { cancel: { version: 1, phase: 'deferred', assistedCycles: 7, deferredReason: 'assistance', resumeAfter: now + 300, terminalProbeAttemptedAt: now - 1 } } })
        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => { db.close(); resolve() }
      }
    })
  }, legacyRound)
  await page.goto('/learn')
  const continueButton = page.getByRole('button', { name: '继续学习', exact: true })
  await expect(continueButton).toBeVisible()
  await expect(page.getByRole('button', { name: '多学五词', exact: true })).toHaveCount(0)
  await page.reload()
  await continueButton.click()
  await waitForActiveLearnSession(page)
  const daily = await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4')!))
  expect(daily.status).toBe('active')
  expect(daily.plannedNewWords).toBe(1)
  expect(daily.plannedNewWordNames).toEqual(['cancel'])
  expect(daily.continueUnfinishedPlan).toBe(true)
  expect(daily.executionExhausted).toBeUndefined()
  expect(daily.completedAt).toBeUndefined()
  const observed = new Set<string>()
  for (let step = 0; step < 60; step++) {
    if (await page.locator('[data-learn-daily-complete]').count()) break
    if (await page.getByText('按任意键开始', { exact: true }).isVisible()) await startTyping(page)
    const record = (await readReviewModeInfo(page)).reviewRecord
    if (record.isFinished) {
      const nextBlock = page.getByRole('button', { name: '按任意键继续', exact: true })
      if (await nextBlock.isVisible()) await nextBlock.click()
      await waitForActiveLearnSession(page)
      continue
    }
    const name = record.words[record.index].name
    const phase = record.acquisitionStates?.[name]?.phase
    observed.add(name)
    await expect(page.locator(`[data-typing-word="${name}"]`)).toBeVisible()
    await expect(page.locator('[data-learn-live-stats]')).toContainText('/1')
    await page.keyboard.type(name, { delay: 20 })
    await expect.poll(async () => {
      if (await page.locator('[data-learn-daily-complete]').count()) return true
      const next = (await readReviewModeInfo(page)).reviewRecord
      return next.id !== record.id || next.index !== record.index || next.acquisitionStates?.[name]?.phase !== phase || next.isFinished
    }).toBe(true)
  }
  await expect(page.getByRole('heading', { name: '今日学习完成', exact: true })).toBeVisible()
  const done = await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4')!))
  expect(observed.has('cancel')).toBe(true)
  expect(observed.size).toBeGreaterThan(1)
  expect(done.plannedNewWords).toBe(1)
  expect(done.status).toBe('completed')
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.getByRole('button', { name: '多学五词', exact: true })).toBeVisible()
})
}
