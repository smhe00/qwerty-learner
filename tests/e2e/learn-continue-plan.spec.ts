import { expect, test } from '@playwright/test'
import { gotoReviewAppReady, readReviewModeInfo, startTyping, waitForActiveLearnSession } from './review-flow-harness'

for (const bridge of ['weak', 'new', 'acquisition'] as const) {
  test(`unfinished plan continues directly with real ${bridge} interleaving and survives reload`, async ({ page }) => {
    test.setTimeout(90_000)
    const words = ['cancel', 'analyse', 'numerous', 'excluded'].map(name => ({ name, trans: [name], usphone: '', ukphone: '' }))
    await page.route('**/dicts/CET4_T.json', route => route.fulfill({ json: words }))
    await page.addInitScript(() => localStorage.setItem('currentDict', JSON.stringify('cet4')))
    await gotoReviewAppReady(page)
    await page.addScriptTag({ type: 'module', content: `
      import { db } from '/src/utils/db/core.ts'
      import { saveLearnDailySession, learnLocalDateKey } from '/src/learn/daily-session.ts'
      const now = Math.floor(Date.now() / 1000)
      await db.wordRecords.clear(); await db.reviewRecords.clear(); await db.reviewWordStates.clear()
      const names = ${JSON.stringify(bridge === 'new' ? ['cancel', 'excluded'] : bridge === 'acquisition' ? ['analyse', 'numerous', 'excluded'] : ['cancel', 'analyse', 'numerous', 'excluded'])}
      await db.reviewWordStates.bulkAdd(names.map((word, index) => ({
        dict: 'cet4', word, createdAt: now - 86400, updatedAt: now - 1, nextReviewAt: now + 86400,
        reviewCount: 1, lapseCount: word === 'analyse' ? 9 : 0, cleanStreak: 0,
        lifecycle: word === 'excluded' ? 'excluded' : 'active', stateVersion: 5,
        schedulerState: { kind: 'fsrs6', difficulty: 5, stability: 1, parameterSetId: 'fsrs6-default-r0.84-no-fuzz-long-term-v1' }
      })))
      await db.wordRecords.add({ dict: 'cet4', word: 'cancel', timeStamp: now - 1, chapter: -1,
        sourceMode: 'learn', learnItemKind: ${JSON.stringify(bridge === 'acquisition' ? 'acquisition' : 'review')}, wrongCount: 1, timing: [], mistakes: {},
        ${bridge === 'acquisition' ? "reviewPolicyDecision: { version: 1, policyVersion: 'learn-acquisition-exposure-v1', reasonCodes: [], conditionVersion: 1 }" : "reviewRatingDecision: { eligible: true, rating: 'again', confidence: 1, reasonCodes: [] }"} })
      ${bridge === 'acquisition' ? `await db.reviewRecords.add({ dict: 'cet4', createTime: now - 2, index: 0, isFinished: true,
        words: [{ name: 'cancel', trans: [], usphone: '', ukphone: '' }], sessionKind: 'acquisition',
        acquisitionStates: { cancel: { version: 1, phase: 'deferred', assistedCycles: 7, deferredReason: 'assistance', resumeAfter: now + 300, terminalProbeAttemptedAt: now - 1 } } })` : ''}
      saveLearnDailySession({ version: 1, sessionId: 'continue-plan', dict: 'cet4', dateKey: learnLocalDateKey(now),
        startedAt: now - 60, status: 'active', executionExhausted: true,
        extraRoundWordNames: ['excluded'], extraRoundStartedAt: now - 20,
        plannedReviewWords: ${JSON.stringify(bridge === 'acquisition' ? ['excluded'] : ['cancel', 'excluded'])}, carryOverAcquisitionWords: [], plannedNewWords: ${bridge === 'acquisition' ? 1 : 0},
        plannedNewWordNames: ${JSON.stringify(bridge === 'acquisition' ? ['cancel'] : [])}, dailyNewTarget: 20, completedBlockIds: [], blockCount: 0,
        accumulatedActiveSeconds: 0, blockMilestones: [1] })
      localStorage.setItem('reviewModeInfo', JSON.stringify({ isReviewMode: true }))
      window.__continueFixtureReady = true
    ` })
    await expect.poll(() => page.evaluate(() => (window as any).__continueFixtureReady)).toBe(true)
    await page.goto('/learn')
    await expect(page.getByRole('button', { name: '继续学习', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '多学五词', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '继续今日计划', exact: true }).click()
    const first = (await waitForActiveLearnSession(page)).reviewRecord
    expect(first.words.map((word: any) => word.name)).toEqual(['analyse', 'numerous'])
    if (bridge !== 'new') {
      expect(first.acquisitionStates.analyse.spacingOnly).toBe(true)
      expect(first.recommendedGoal).toBeUndefined()
    } else {
      expect(first.optionalNewWords.map((word: any) => word.name)).toEqual(['analyse', 'numerous'])
    }
    await page.reload()
    const restored = (await waitForActiveLearnSession(page)).reviewRecord
    expect(restored.id).toBe(first.id)
    const observed = new Set<string>()
    for (let step = 0; step < 35; step++) {
      if (await page.locator('[data-learn-daily-complete]').count()) break
      if (await page.getByText('按任意键开始', { exact: true }).isVisible()) await startTyping(page)
      const rec = (await readReviewModeInfo(page)).reviewRecord
      const name = rec.words[rec.index]?.name
      if (!name || rec.isFinished) {
        await expect(page.locator('[data-typing-word]:visible')).toBeVisible()
        continue
      }
      observed.add(name)
      expect(name).not.toBe('excluded')
      const phase = rec.acquisitionStates?.[name]?.phase
      await expect(page.locator(`[data-typing-word="${name}"]`)).toBeVisible()
      await page.keyboard.type(name, { delay: 30 })
      await expect.poll(async () => {
        if (await page.locator('[data-learn-daily-complete]').count()) return true
        const next = (await readReviewModeInfo(page)).reviewRecord
        return next.id !== rec.id || next.index !== rec.index || next.isFinished || next.acquisitionStates?.[name]?.phase !== phase
      }).toBe(true)
    }
    await expect(page.locator('[data-learn-daily-complete]')).toBeVisible()
    expect(observed.has('cancel')).toBe(true)
    expect(observed.has('analyse')).toBe(true)
    expect(observed.has('numerous')).toBe(true)
    const daily = await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4')!))
    expect(daily.plannedNewWords).toBe(bridge === 'acquisition' ? 1 : 0)
    expect(daily.dailyNewTarget).toBe(20)
    expect(daily.plannedReviewWords).toEqual(bridge === 'acquisition' ? ['excluded'] : ['cancel', 'excluded'])
    expect(daily.excludedWordNames).toEqual(['excluded'])
    expect(daily.status).toBe('completed')
    if (bridge !== 'new') {
      await page.addScriptTag({ type: 'module', content: `
        import { db } from '/src/utils/db/core.ts'
        window.__continuePracticeEvidence = {
          states: (await db.reviewWordStates.toArray()).filter(state => ['analyse', 'numerous'].includes(state.word)),
          rows: (await db.wordRecords.toArray()).filter(record => ['analyse', 'numerous'].includes(record.word))
        }
      ` })
      await expect.poll(() => page.evaluate(() => (window as any).__continuePracticeEvidence)).toBeTruthy()
      const evidence = await page.evaluate(() => (window as any).__continuePracticeEvidence)
      expect(evidence.states.every((state: any) => state.reviewCount === 1)).toBe(true)
      expect(evidence.rows.length).toBeGreaterThanOrEqual(2)
      expect(evidence.rows.every((record: any) => record.learnItemKind === 'practice')).toBe(true)
    }
  })
}
