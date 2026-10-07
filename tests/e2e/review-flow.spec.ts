// RC 2026-09-30 review-formal-gate-v1 production acceptance marker
import { readFile } from 'node:fs/promises'
import {
  parseDiagnosticExport,
  replayDiagnostic,
} from '../../src/dev/replay'
import { expect, test } from '@playwright/test'
import {
  putDueReviewWordState,
  readRenderedAttemptState,
  readReviewGateState,
  readReviewModeInfo,
  readReviewWordRecords,
  reviewWords,
  seedAcquisitionSession,
  seedReviewAdmissionCase,
  seedReviewSession,
  startTyping,
  waitForActiveLearnSession,
  waitForRenderedWord,
  waitForReviewIndex,
} from './review-flow-harness'

test('multi-word Review advances through every rendered word and finishes', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await seedReviewSession(page, reviewWords, 900001)
  await page.goto('/learn')
  await startTyping(page)

  await waitForRenderedWord(page, 'cancel')
  await page.keyboard.type('cancel')
  await waitForReviewIndex(page, 1)
  await waitForRenderedWord(page, 'analyse')

  await page.keyboard.type('analyse')
  await waitForReviewIndex(page, 2)
  await waitForRenderedWord(page, 'numerous')

  await page.keyboard.type('numerous')
  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return info?.reviewRecord?.isFinished
    })
    .toBe(true)

  const persisted = await readReviewWordRecords(
    page,
    reviewWords.map((word) => word.name),
  )
  expect(persisted.map((record) => record.word)).toEqual([
    'cancel',
    'analyse',
    'numerous',
  ])
  expect(persisted.every((record) => record.wrongCount === 0)).toBe(true)

  await expect(
    page.locator('[data-learn-result-screen]'),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '阶段完成', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('CET-4 · Learn', { exact: true })).toBeVisible()
  const learnResult = page.locator('[data-learn-result-screen]')
  await expect(learnResult).toHaveAttribute('data-learn-block-pause', 'true')
  // Block Pause renders immediately, but progress is only released after the
  // durable persistence barrier settles. Wait on the actual continuation
  // readiness contract instead of assuming a fixed IndexedDB latency.
  await expect(
    page.getByRole('button', { name: '按任意键继续', exact: true }),
  ).toBeEnabled({ timeout: 15_000 })
  await expect(
    learnResult.getByText('今日进度', { exact: true }),
  ).toBeVisible()
  await expect(
    learnResult.getByText('今日复习', { exact: true }),
  ).toBeVisible()
  await expect(
    learnResult.getByText('今日新词', { exact: true }),
  ).toBeVisible()
  await expect(
    learnResult.getByText('待完成', { exact: true }),
  ).toBeVisible()
  await expect(
    learnResult.getByText('正确率', { exact: true }),
  ).toHaveCount(0)
  await expect(
    learnResult.getByText('WPM', { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '按任意键继续', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '完成', exact: true }),
  ).toHaveCount(0)

  const finishedSession = await readReviewModeInfo(page)
  const finishedSessionId =
    finishedSession?.reviewRecord?.id ??
    finishedSession?.reviewRecord?.createTime

  await expect
    .poll(async () =>
      page.evaluate(async (sessionId) => {
        return new Promise<boolean>((resolve, reject) => {
          const request = indexedDB.open('RecordDB')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('reviewRecords', 'readonly')
            const all = tx.objectStore('reviewRecords').getAll()
            all.onerror = () => reject(all.error)
            all.onsuccess = () => {
              const match = all.result.find(
                (record) =>
                  (record.id ?? record.createTime) === sessionId,
              )
              resolve(match?.isFinished === true)
              db.close()
            }
          }
        })
      }, finishedSessionId),
    )
    .toBe(true)

  await page
    .getByRole('button', {
      name: '暂停 Learn',
      exact: true,
    })
    .click()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.getByRole('button', { name: '开始 Learn', exact: true }),
  ).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.getByRole('button', { name: '开始 Learn', exact: true }),
  ).toBeVisible()

  await page
    .getByRole('button', { name: '开始 Learn', exact: true })
    .click()
  await expect(page).toHaveURL(/\/learn$/)
  const afterContinue = await waitForActiveLearnSession(page)
  expect(afterContinue?.reviewRecord?.isFinished).toBe(false)
  expect(
    afterContinue?.reviewRecord?.id ??
      afterContinue?.reviewRecord?.createTime,
  ).not.toBe(finishedSessionId)

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        return new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('RecordDB')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('chapterRecords', 'readonly')
            const count = tx.objectStore('chapterRecords').count()
            count.onerror = () => reject(count.error)
            count.onsuccess = () => {
              resolve(count.result)
              db.close()
            }
          }
        })
      }),
    )
    .toBe(0)

  expect(pageErrors).toEqual([])
})

test('closing a Learn block pause stays in Learn idle with Start available', async ({
  page,
}) => {
  await seedReviewSession(page, [reviewWords[0]], 900020)
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  await page.keyboard.type('cancel')

  await expect(
    page.locator('[data-learn-result-screen]'),
  ).toBeVisible()

  await page
    .getByRole('button', {
      name: '暂停 Learn',
      exact: true,
    })
    .click()

  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.locator('[data-learn-result-screen]'),
  ).toHaveCount(0)

  const learnMode = page.getByRole('button', {
    name: 'Learn',
    exact: true,
  })
  await expect(learnMode).toBeVisible()
  await expect(learnMode).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', {
      name: '开始 Learn',
      exact: true,
    }),
  ).toBeVisible()
})

test('post-completion extra key cannot become an out-of-range typo on the completed word', async ({
  page,
}) => {
  await seedReviewSession(page, [reviewWords[0]], 900002)
  await page.goto('/')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  // Send an extra key in the same burst. The terminal input gate must ensure
  // it cannot become wrongIndex === word.length for "cancel".
  await page.keyboard.type('cancelx')

  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return info?.reviewRecord?.isFinished
    })
    .toBe(true)

  const persisted = await readReviewWordRecords(page, ['cancel'])
  expect(persisted).toHaveLength(1)
  expect(persisted[0].wrongCount).toBe(0)
  expect(persisted[0].mistakes?.['6']).toBeUndefined()
  expect(
    persisted[0].typingTelemetry?.attempts?.some(
      (attempt) => attempt.wrongIndex === 6,
    ),
  ).toBe(false)
})


test('fresh Typing failure cannot reopen a previously reviewed Learn word', async ({
  page,
}) => {
  await seedReviewAdmissionCase(page, {
    freshLearningAfterReview: true,
  })

  await page.goto('/learn')
  const info = await waitForActiveLearnSession(page)
  expect(info?.reviewRecord?.sessionKind).toBe('acquisition')
  expect(
    info?.reviewRecord?.words?.some(
      (word: { name: string }) => word.name === 'cancel',
    ),
  ).toBe(false)
})

test('no-due screen offers Force Review and force bypasses only the time gate', async ({
  page,
}) => {
  await seedReviewAdmissionCase(page, {
    freshLearningAfterReview: false,
  })

  await page.getByRole('button', { name: '开始学习' }).click()

  await expect(
    page.getByText(
      '今天没有到期的长期学习词。你可以等待调度时间，或进行一次额外复习。',
    ),
  ).toBeVisible()

  await page.getByRole('button', { name: '额外复习' }).click()

  await expect(page).toHaveURL(/\/learn$/)
  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return info?.reviewRecord?.words?.map(
        (word: { name: string }) => word.name,
      )
    })
    .toEqual(['cancel'])
})


test('new Review session forces a canonical cold probe independent of ordinary settings', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({ isReviewMode: false }),
    )
  })
  await putDueReviewWordState(page, 'cancel')

  await page.goto('/learn')
  const sessionInfo = await waitForActiveLearnSession(page)
  expect(sessionInfo?.reviewRecord?.exercisePlans?.cancel).toMatchObject({
    condition: {
      purpose: 'probe',
      source: 'adaptive-policy',
      audio: 'none',
      meaning: 'visible',
      phonetic: 'hidden',
      letters: { mode: 'all-hidden' },
      probeDimension: 'none',
    },
    decision: {
      policyVersion: 'canonical-review-probe-v1',
    },
  })

  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const word = page.locator('[data-typing-word="cancel"]')
  await expect(word).toHaveAttribute('data-review-purpose', 'probe')
  await expect(word).toHaveAttribute('data-review-probe-dimension', 'none')
  await expect(word).toHaveAttribute('data-review-audio', 'none')
  await expect(word).toHaveAttribute('data-review-meaning', 'visible')
  await expect(word).toHaveAttribute('data-review-phonetic', 'hidden')
  await expect(word).toHaveAttribute('data-review-letters', 'all-hidden')
  await expect(word).toHaveAttribute(
    'data-review-policy',
    'canonical-review-probe-v1',
  )
  await expect(word).toHaveText('______')

  await page.keyboard.type('cancel')

  await expect
    .poll(async () => {
      const records = await readReviewWordRecords(page, ['cancel'])
      return records.length
    })
    // One native FSRS seed event plus the current cold-probe result.
    .toBe(2)

  const persistedCondition = await page.evaluate(async () => {
    return new Promise<{
      exerciseCondition?: {
        purpose?: string
        source?: string
        audio?: string
        meaning?: string
        phonetic?: string
        letters?: { mode?: string }
        probeDimension?: string
      }
      learningContext?: {
        pronunciationAutomaticPlayCount?: number
      }
    } | null>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('wordRecords', 'readonly')
        const all = tx.objectStore('wordRecords').getAll()
        all.onerror = () => reject(all.error)
        all.onsuccess = () => {
          const record = [...all.result]
            .reverse()
            .find(
              (item) =>
                item.chapter === -1 &&
                item.word === 'cancel',
            )
          resolve(
            record
              ? {
                  exerciseCondition: record.exerciseCondition,
                  learningContext: record.learningContext,
                }
              : null,
          )
          db.close()
        }
      }
    })
  })

  expect(persistedCondition?.exerciseCondition).toMatchObject({
    purpose: 'probe',
    source: 'adaptive-policy',
    audio: 'none',
    meaning: 'visible',
    phonetic: 'hidden',
    letters: { mode: 'all-hidden' },
    probeDimension: 'none',
  })
  expect(
    persistedCondition?.learningContext?.pronunciationAutomaticPlayCount ?? 0,
  ).toBe(0)
})


test('Phase D live gate applies one canonical rating through the scheduler', async ({
  page,
}) => {
  // Seed scheduler state before installing the active Learn checkpoint. This
  // keeps fixture writes independent from the live Learn database connection.
  await page.goto('/')
  const before = await putDueReviewWordState(page, 'cancel')
  await seedReviewSession(page, reviewWords.slice(0, 1), 900004)
  await page.goto('/learn')
  await waitForActiveLearnSession(page)

  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  await page.keyboard.type('cancel')

  await expect
    .poll(async () => {
      const result = await readReviewGateState(page, 'cancel')
      return (
        result.state?.reviewCount === 2 &&
        result.decision?.eligible === true &&
        result.state?.lastOutcome === result.decision.rating &&
        result.shadow?.libraryVersion === '5.4.2'
      )
    })
    .toBe(true)

  const after = await readReviewGateState(page, 'cancel')
  expect(['hard', 'good', 'easy']).toContain(after.decision?.rating)
  expect(after.state?.schedulerKind).toBe('fsrs6')
  expect(after.state?.nextReviewAt).toBeGreaterThan(before.nextReviewAt)
  expect(after.shadow?.algorithmModel).toBe('fsrs-6')
  expect(after.shadow?.rating).toBe(after.decision?.rating)
  // basic-v2 is now the rollback/comparator trajectory, not the active due.
  expect(after.shadow?.basicV2?.dueAt).toBeGreaterThan(before.nextReviewAt)
  expect(after.shadow?.basicV2?.nominalIntervalDays).toBeGreaterThan(0)
  expect(
    Object.keys(after.shadow?.counterfactual ?? {}).sort(),
  ).toEqual(['again', 'easy', 'good', 'hard'])
})

test('Hint V2 freezes Cold Probe evidence before assisted completion reaches the scheduler', async ({
  page,
}) => {
  await page.goto('/')
  await putDueReviewWordState(page, 'cancel')
  await seedReviewSession(page, reviewWords.slice(0, 1), 900005)
  await page.goto('/learn')
  await waitForActiveLearnSession(page)

  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  const word = page.locator('[data-typing-word="cancel"]')

  await page.keyboard.type('cax')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await expect(word).toHaveAttribute('data-review-hint-level', '0')
  await expect(word).toHaveAttribute('data-review-hint-failures', '1')

  await page.keyboard.type('cancel')

  await expect
    .poll(async () => {
      const records = await readReviewWordRecords(page, ['cancel'])
      const latest = records[records.length - 1] as {
        learningContext?: {
          coldProbeEvidence?: {
            retrievalValidity?: string
          }
          reviewHint?: {
            failureCount?: number
          }
        }
        reviewRatingDecision?: {
          eligible?: boolean
          reasonCodes?: string[]
        }
      }
      return {
        frozen:
          latest?.learningContext?.coldProbeEvidence
            ?.retrievalValidity,
        failures:
          latest?.learningContext?.reviewHint?.failureCount,
        eligible:
          latest?.reviewRatingDecision?.eligible,
        frozenReason:
          latest?.reviewRatingDecision?.reasonCodes?.includes(
            'cold-probe-failure-frozen',
          ),
      }
    })
    .toEqual({
      frozen: 'independent',
      failures: 1,
      eligible: true,
      frozenReason: true,
    })
})

test('forgotten cold probe schedules one reinforcement and reinforcement cannot rate again', async ({
  page,
}) => {
  await seedReviewSession(page, reviewWords.slice(0, 2), 900006)
  await page.goto('/')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const cancel = page.locator('[data-typing-word="cancel"]')
  await page.keyboard.press('Escape')
  await expect(cancel).toHaveAttribute('data-review-hint-level', '3')
  await expect(cancel).toHaveText('cancel')
  await page.keyboard.type('cancel')

  await waitForReviewIndex(page, 1)
  let info = await readReviewModeInfo(page)
  expect(
    info?.reviewRecord?.words?.map((word: { name: string }) => word.name),
  ).toEqual(['cancel', 'analyse', 'cancel'])
  expect(info?.reviewRecord?.reinforcementCounts?.cancel).toBe(1)
  expect(info?.reviewRecord?.itemStates?.cancel?.phase).toBe(
    'reinforcement',
  )

  await waitForRenderedWord(page, 'analyse')
  await page.keyboard.type('analyse')
  await waitForReviewIndex(page, 2)
  await waitForRenderedWord(page, 'cancel')
  await page.keyboard.type('cancel')

  await expect
    .poll(async () => {
      const current = await readReviewModeInfo(page)
      return {
        finished: current?.reviewRecord?.isFinished,
        reinforcementCount:
          current?.reviewRecord?.reinforcementCounts?.cancel,
        phase: current?.reviewRecord?.itemStates?.cancel?.phase,
      }
    })
    .toEqual({
      finished: true,
      reinforcementCount: 1,
      phase: 'done',
    })

  const records = await readReviewWordRecords(page, ['cancel'])
  expect(records).toHaveLength(2)
  const latest = records[records.length - 1] as {
    reviewRatingDecision?: {
      eligible?: boolean
      reason?: string
    }
  }
  expect(latest.reviewRatingDecision).toMatchObject({
    eligible: false,
    reason: 'non-cold-attempt',
  })
})

test('ESC enters full answer immediately and skip lock blocks navigation until corrective typing', async ({
  page,
}) => {
  await seedReviewSession(page, reviewWords.slice(0, 2), 900010)
  await page.goto('/')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const cancel = page.locator('[data-typing-word="cancel"]')
  await page.keyboard.press('Escape')
  await expect(cancel).toHaveAttribute('data-review-hint-level', '3')
  await expect(cancel).toHaveAttribute('data-review-hint-stage', 'hint-3')
  await expect(cancel).toHaveText('cancel')
  await expect(cancel).toHaveAttribute('data-review-skip-locked', 'true')

  await page.keyboard.press('Control+Shift+ArrowRight')
  await page.waitForTimeout(100)

  await expect(cancel).toBeVisible()
  const info = await readReviewModeInfo(page)
  expect(info?.reviewRecord?.index).toBe(0)

  await page.keyboard.type('cancel')
  await waitForReviewIndex(page, 1)
  await waitForRenderedWord(page, 'analyse')
})

test('Learn exposes only one unfinished session and cannot create a duplicate from the plan page', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({
        isReviewMode: false,
      }),
    )

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewRecords', 'readwrite')
        tx.objectStore('reviewRecords').clear()
        tx.objectStore('reviewRecords').add({
          dict: 'cet4',
          index: 0,
          createTime: 900_001,
          isFinished: false,
          sessionKind: 'acquisition',
          words: [
            {
              name: 'cancel',
              trans: [],
              usphone: '',
              ukphone: '',
            },
          ],
        })
        // A newer finished historical row must not hide the unfinished
        // recovery checkpoint above.
        tx.objectStore('reviewRecords').add({
          dict: 'cet4',
          index: 1,
          createTime: 900_002,
          isFinished: true,
          sessionKind: 'review',
          words: [
            {
              name: 'analyse',
              trans: [],
              usphone: '',
              ukphone: '',
            },
          ],
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }
    })
  })

  await page.goto('/learn')
  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.getByRole('button', { name: '开始', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Continue', { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '额外复习', exact: true }),
  ).toHaveCount(0)

  const beforeCount = await page.evaluate(async () => {
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewRecords', 'readonly')
        const count = tx.objectStore('reviewRecords').count()
        count.onerror = () => reject(count.error)
        count.onsuccess = () => {
          resolve(count.result)
          db.close()
        }
      }
    })
  })

  const afterCount = await page.evaluate(async () => {
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewRecords', 'readonly')
        const count = tx.objectStore('reviewRecords').count()
        count.onerror = () => reject(count.error)
        count.onsuccess = () => {
          resolve(count.result)
          db.close()
        }
      }
    })
  })

  expect(beforeCount).toBe(2)
  expect(afterCount).toBe(2)
})

test('Learn starts new acquisition with exposure and does not admit after visible copy', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    localStorage.setItem('isOpenDarkModeAtom', JSON.stringify(false))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({ isReviewMode: false }),
    )

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const names = ['wordRecords', 'reviewWordStates', 'reviewRecords']
        const tx = db.transaction(names, 'readwrite')
        for (const name of names) tx.objectStore(name).clear()

        const now = Math.floor(Date.now() / 1000)
        tx.objectStore('wordRecords').add({
          word: 'cancel',
          timeStamp: now - 60,
          dict: 'cet4',
          chapter: 0,
          timing: [],
          wrongCount: 2,
          mistakes: { 0: ['x'] },
          sourceMode: 'typing',
        })
        tx.objectStore('reviewWordStates').put({
          dict: 'cet4',
          word: 'cancel',
          createdAt: now - 60,
          updatedAt: now - 30,
          nextReviewAt: now - 30,
          reviewCount: 0,
          lapseCount: 0,
          cleanStreak: 0,
          lifecycle: 'active',
          stateVersion: 4,
          schedulerState: {
            kind: 'basic-v2',
            stage: 0,
            intervalDays: 0,
          },
        })

        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }
    })
  })

  await page.goto('/learn')
  const info = await waitForActiveLearnSession(page)
  expect(info?.reviewRecord?.sessionKind).toBe('acquisition')
  expect(info?.reviewRecord?.words?.length).toBe(20)

  const firstWord = info?.reviewRecord?.words?.[0]?.name as string
  expect(firstWord).toBeTruthy()
  expect(info?.reviewRecord?.acquisitionStates?.[firstWord]).toMatchObject({
    phase: 'exposure',
    assistedCycles: 0,
  })
  expect(info?.reviewRecord?.exercisePlans?.[firstWord]).toMatchObject({
    condition: {
      purpose: 'training',
      audio: 'automatic',
      meaning: 'visible',
      phonetic: 'visible',
      letters: { mode: 'all-visible' },
      probeDimension: 'none',
    },
    decision: {
      policyVersion: 'learn-acquisition-exposure-v1',
    },
  })

  await startTyping(page)
  await waitForRenderedWord(page, firstWord)

  const rendered = page.locator(`[data-typing-word="${firstWord}"]`)
  await expect(rendered).toHaveAttribute('data-review-purpose', 'training')
  await expect(rendered).toHaveAttribute('data-review-letters', 'all-visible')
  await expect(
    page.locator('[data-learn-acquisition-phase="exposure"]'),
  ).toBeVisible()
  await expect(
    page.locator('[data-typing-translation="visible"]'),
  ).toBeVisible()

  await page.keyboard.type(firstWord)

  await expect
    .poll(async () => {
      const current = await readReviewModeInfo(page)
      return {
        index: current?.reviewRecord?.index,
        phase:
          current?.reviewRecord?.acquisitionStates?.[firstWord]?.phase,
        queue: current?.reviewRecord?.words
          ?.slice(0, 4)
          .map((word: { name: string }) => word.name),
      }
    })
    .toEqual({
      index: 1,
      phase: 'supported',
      queue: [
        firstWord,
        info?.reviewRecord?.words?.[1]?.name,
        info?.reviewRecord?.words?.[2]?.name,
        firstWord,
      ],
    })

  const afterExposure = await page.evaluate(async (word) => {
    return new Promise<{
      stateExists: boolean
      record?: {
        sourceMode?: string
        learnItemKind?: string
        policyVersion?: string
      }
    }>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(
          ['reviewWordStates', 'wordRecords'],
          'readonly',
        )
        const states = tx.objectStore('reviewWordStates').getAll()
        const records = tx.objectStore('wordRecords').getAll()
        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => {
          const record = [...records.result]
            .reverse()
            .find((item) => item.dict === 'cet4' && item.word === word)
          resolve({
            stateExists: states.result.some(
              (item) => item.dict === 'cet4' && item.word === word,
            ),
            record: record
              ? {
                  sourceMode: record.sourceMode,
                  learnItemKind: record.learnItemKind,
                  policyVersion:
                    record.reviewPolicyDecision?.policyVersion,
                }
              : undefined,
          })
          db.close()
        }
      }
    })
  }, firstWord)

  expect(afterExposure).toEqual({
    stateExists: false,
    record: {
      sourceMode: 'learn',
      learnItemKind: 'acquisition',
      policyVersion: 'learn-acquisition-exposure-v1',
    },
  })
})

test('Recovery Window places two confidence-training items before an elevated-strain retry', async ({
  page,
}) => {
  await seedAcquisitionSession(
    page,
    reviewWords,
    919989,
    'exposure',
    4,
    'elevated',
    { cancel: 'independent' },
  )
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  let word = page.locator('[data-typing-word="cancel"]')
  await expect(word).toHaveAttribute('data-review-purpose', 'probe')
  await page.keyboard.type('cax')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await page.keyboard.type('cancel')

  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return {
        index: info?.reviewRecord?.index,
        queue: info?.reviewRecord?.words?.map(
          (item: { name: string }) => item.name,
        ),
        cancel:
          info?.reviewRecord?.acquisitionStates?.cancel,
      }
    })
    .toMatchObject({
      index: 1,
      queue: ['cancel', 'analyse', 'numerous', 'cancel'],
      cancel: {
        phase: 'supported',
        assistedCycles: 1,
        scaffoldHintPosition: 2,
      },
    })

  await waitForRenderedWord(page, 'analyse')
  const shell = page.locator('[data-learn-acquisition-phase="exposure"]')
  word = page.locator('[data-typing-word="analyse"]')
  await expect(shell).toHaveAttribute('data-learn-scaffold-level', 'S0')
  await expect(word).toHaveAttribute('data-review-purpose', 'training')
  await expect(word).toHaveAttribute('data-review-letters', 'all-visible')
})

test('dynamic scaffold starts Supported acquisition at S1 under recovery strain', async ({
  page,
}) => {
  await seedAcquisitionSession(
    page,
    [reviewWords[0]],
    919990,
    'supported',
    4,
    'recovery',
  )
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const shell = page.locator('[data-learn-acquisition-phase="supported"]')
  const word = page.locator('[data-typing-word="cancel"]')
  await expect(shell).toHaveAttribute('data-learn-scaffold-level', 'S1')
  await expect(shell).toHaveAttribute(
    'data-learn-scaffold-policy',
    'learn-dynamic-scaffold-v1.1',
  )
  await expect(word).toHaveAttribute('data-review-purpose', 'training')
  await expect(word).toHaveAttribute('data-review-audio', 'automatic')
  await expect(word).toHaveAttribute('data-review-phonetic', 'visible')
  await expect(word).toHaveAttribute('data-review-letters', 'all-hidden')
})

test('failed Independent recall targets the wrong position in the next S1 attempt', async ({
  page,
}) => {
  await seedAcquisitionSession(
    page,
    [reviewWords[0]],
    919992,
    'independent',
    4,
    'low',
  )
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  let word = page.locator('[data-typing-word="cancel"]')
  await expect(word).toHaveAttribute('data-review-letters', 'all-hidden')

  await page.keyboard.type('cax')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await page.keyboard.type('cancel')

  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      const state = info?.reviewRecord?.acquisitionStates?.cancel
      return {
        index: info?.reviewRecord?.index,
        phase: state?.phase,
        assistedCycles: state?.assistedCycles,
        scaffoldHintPosition: state?.scaffoldHintPosition,
        letters:
          info?.reviewRecord?.exercisePlans?.cancel?.condition?.letters,
      }
    })
    .toEqual({
      index: 1,
      phase: 'supported',
      assistedCycles: 1,
      scaffoldHintPosition: 2,
      letters: {
        mode: 'partial',
        visiblePositions: [2],
      },
    })

  await waitForRenderedWord(page, 'cancel')
  const shell = page.locator('[data-learn-acquisition-phase="supported"]')
  word = page.locator('[data-typing-word="cancel"]')

  await expect(shell).toHaveAttribute('data-learn-scaffold-level', 'S1')
  await expect(shell).toHaveAttribute(
    'data-learn-scaffold-hint-position',
    '2',
  )
  await expect(word).toHaveAttribute('data-review-letters', 'partial')
  await expect(word).toHaveAttribute('data-review-hint-level', '1')
  await expect(word).toHaveAttribute('data-review-hint-stage', 'hint-1')

  await page.keyboard.press('Escape')
  await expect(word).toHaveAttribute('data-review-hint-level', '3')
  await expect(word).toHaveAttribute('data-review-hint-stage', 'hint-3')
  await expect(word).toHaveText('cancel')
})

test('dynamic scaffold never weakens Independent acquisition under recovery strain', async ({
  page,
}) => {
  await seedAcquisitionSession(
    page,
    [reviewWords[0]],
    919991,
    'independent',
    4,
    'recovery',
  )
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const shell = page.locator('[data-learn-acquisition-phase="independent"]')
  const word = page.locator('[data-typing-word="cancel"]')
  await expect(shell).toHaveAttribute('data-learn-scaffold-level', 'S3')
  await expect(word).toHaveAttribute('data-review-purpose', 'probe')
  await expect(word).toHaveAttribute('data-review-audio', 'none')
  await expect(word).toHaveAttribute('data-review-phonetic', 'hidden')
  await expect(word).toHaveAttribute('data-review-letters', 'all-hidden')
})

test('clean but short-gap Independent recall defers without false admission', async ({
  page,
}) => {
  await seedAcquisitionSession(
    page,
    [reviewWords[0]],
    920000,
    'independent',
    0,
  )
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  await page.keyboard.type('cancel')

  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return info?.reviewRecord?.isFinished
    })
    .toBe(true)

  const info = await readReviewModeInfo(page)
  const acquisitionState =
    info?.reviewRecord?.acquisitionStates?.cancel
  expect(acquisitionState).toMatchObject({
    phase: 'deferred',
    assistedCycles: 0,
    deferredReason: 'spacing',
  })
  expect(acquisitionState?.resumeAfter).toBeGreaterThan(
    Math.floor(Date.now() / 1000),
  )

  const durableState = await page.evaluate(async () => {
    return new Promise<any>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewWordStates', 'readonly')
        const get = tx
          .objectStore('reviewWordStates')
          .index('[dict+word]')
          .get(['cet4', 'cancel'])
        get.onerror = () => reject(get.error)
        get.onsuccess = () => {
          resolve(get.result)
          db.close()
        }
      }
    })
  })
  expect(durableState).toBeUndefined()
  await expect(
    page.locator('[data-learn-result-screen]'),
  ).toBeVisible()
})

test('spacing-deferred acquisition resumes as Independent after its delay', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(-1))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({
        isReviewMode: false,
      }),
    )
  })
  await page.goto('/typing')

  const resumeAfter = Math.floor(Date.now() / 1000) - 1
  await page.evaluate(
    async ({ word, resumeAt }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('RecordDB')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('reviewRecords', 'readwrite')
          tx.objectStore('reviewRecords').add({
            dict: 'cet4',
            index: 0,
            createTime: resumeAt - 300,
            isFinished: true,
            sessionKind: 'acquisition',
            words: [word],
            acquisitionStates: {
              [word.name]: {
                version: 1,
                phase: 'deferred',
                assistedCycles: 0,
                independentInterveningItems: 0,
                deferredReason: 'spacing',
                resumeAfter: resumeAt,
              },
            },
          })
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      })
    },
    { word: reviewWords[0], resumeAt: resumeAfter },
  )

  await page.goto('/learn')
  const info = await waitForActiveLearnSession(page)
  expect(info?.reviewRecord?.sessionKind).toBe('acquisition')
  expect(info?.reviewRecord?.words?.[0]?.name).toBe('cancel')
  expect(
    info?.reviewRecord?.acquisitionStates?.cancel,
  ).toMatchObject({
    phase: 'independent',
    assistedCycles: 0,
    independentInterveningItems: 2,
  })

  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  const word = page.locator('[data-typing-word="cancel"]')
  await expect(word).toHaveAttribute('data-review-purpose', 'probe')
  await expect(word).toHaveAttribute(
    'data-review-letters',
    'all-hidden',
  )
})

test('clean Independent acquisition is the admission boundary', async ({
  page,
}) => {
  await seedAcquisitionSession(
    page,
    [reviewWords[0]],
    920001,
    'independent',
  )
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const word = page.locator('[data-typing-word="cancel"]')
  await expect(word).toHaveAttribute('data-review-purpose', 'probe')
  await expect(word).toHaveAttribute('data-review-letters', 'all-hidden')
  await expect(
    page.locator('[data-learn-acquisition-phase="independent"]'),
  ).toBeVisible()

  await page.keyboard.type('cancel')

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        return new Promise<{
          lifecycle?: string
          reviewCount?: number
          lapseCount?: number
          lastOutcome?: string
          dueDelta?: number
        }>((resolve, reject) => {
          const request = indexedDB.open('RecordDB')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('reviewWordStates', 'readonly')
            const get = tx
              .objectStore('reviewWordStates')
              .index('[dict+word]')
              .get(['cet4', 'cancel'])
            get.onerror = () => reject(get.error)
            get.onsuccess = () => {
              const state = get.result
              resolve({
                lifecycle: state?.lifecycle,
                reviewCount: state?.reviewCount,
                lapseCount: state?.lapseCount,
                lastOutcome: state?.lastOutcome,
                dueDelta:
                  state?.nextReviewAt === undefined
                    ? undefined
                    : state.nextReviewAt -
                      Math.floor(Date.now() / 1000),
              })
              db.close()
            }
          }
        })
      })
    })
    .toMatchObject({
      lifecycle: 'active',
      reviewCount: 0,
      lapseCount: 0,
    })

  await expect(
    page.locator('[data-learn-result-screen]'),
  ).toBeVisible()
  const learnResult = page.locator('[data-learn-result-screen]')
  await expect(learnResult).toHaveAttribute('data-learn-block-pause', 'true')
  await expect(
    page.getByRole('heading', { name: '阶段完成', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '按任意键继续', exact: true }),
  ).toBeEnabled({ timeout: 15_000 })
  await expect(
    learnResult.getByText('今日进度', { exact: true }),
  ).toBeVisible()
  await expect(
    learnResult.getByText('今日新词', { exact: true }),
  ).toBeVisible()
  await expect(
    learnResult.getByText('待完成', { exact: true }),
  ).toBeVisible()
  await expect(
    learnResult.getByText('正确率', { exact: true }),
  ).toHaveCount(0)
  await expect(
    learnResult.getByText('WPM', { exact: true }),
  ).toHaveCount(0)

  const admitted = await page.evaluate(async () => {
    return new Promise<any>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewWordStates', 'readonly')
        const get = tx
          .objectStore('reviewWordStates')
          .index('[dict+word]')
          .get(['cet4', 'cancel'])
        get.onerror = () => reject(get.error)
        get.onsuccess = () => {
          resolve(get.result)
          db.close()
        }
      }
    })
  })
  expect(admitted.lastOutcome).toBeUndefined()
  expect(admitted.nextReviewAt).toBeGreaterThan(
    Math.floor(Date.now() / 1000) + 86_300,
  )
})

test('a due ACTIVE word is reviewed before any unseen acquisition word', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({
        isReviewMode: false,
      }),
    )

    const now = Math.floor(Date.now() / 1000)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(
          ['wordRecords', 'reviewWordStates', 'reviewRecords'],
          'readwrite',
        )
        tx.objectStore('wordRecords').clear()
        tx.objectStore('reviewRecords').clear()
        tx.objectStore('reviewWordStates').clear()
        tx.objectStore('wordRecords').add({
          word: 'cancel',
          timeStamp: now - 86_500,
          dict: 'cet4',
          chapter: -1,
          timing: [],
          wrongCount: 0,
          mistakes: {},
          sourceMode: 'learn',
          learnItemKind: 'acquisition',
        })
        tx.objectStore('reviewWordStates').put({
          dict: 'cet4',
          word: 'cancel',
          createdAt: now - 100,
          updatedAt: now - 100,
          nextReviewAt: now - 1,
          reviewCount: 0,
          lapseCount: 0,
          cleanStreak: 0,
          lifecycle: 'active',
          stateVersion: 4,
          schedulerState: {
            kind: 'basic-v1',
            stage: 0,
            intervalDays: 0,
          },
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }
    })
  })

  await page.goto('/learn')
  const info = await waitForActiveLearnSession(page)

  expect(info?.reviewRecord?.sessionKind).toBe('mixed')
  expect(info?.reviewRecord?.words?.[0]?.name).toBe('cancel')
  expect(info?.reviewRecord?.itemKinds?.cancel).toBe('review')
  expect(
    Object.values(
      info?.reviewRecord?.itemKinds ?? {},
    ),
  ).toContain('acquisition')
  expect(info?.reviewRecord?.words?.length).toBeLessThanOrEqual(20)
  expect(
    info?.reviewRecord?.exercisePlans?.cancel?.condition,
  ).toMatchObject({
    purpose: 'probe',
    letters: { mode: 'all-hidden' },
    audio: 'none',
  })
})


test('Hint V2 reveals Minimal, Strong, then Full after exactly three failed attempts', async ({
  page,
}) => {
  await seedReviewSession(page, reviewWords.slice(0, 1), 900030)
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const word = page.locator('[data-typing-word="cancel"]')
  await expect(word).toHaveAttribute('data-review-hint-level', 'cold')
  await expect(word).toHaveText('______')

  // fail #1 -> Minimal Hint at the observed wrong position.
  await page.keyboard.type('cax')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await expect(word).toHaveAttribute('data-review-hint-level', '0')
  await expect(word).toHaveAttribute('data-review-hint-failures', '1')
  await expect(word).toHaveAttribute('data-review-hint-position', '2')
  await expect(word).toHaveAttribute('data-review-forced-reveal', '2')
  await expect(word).toHaveText('__n___')

  // fail #2 -> Strong Hint: partial spelling + audio + phonetic.
  await page.keyboard.type('x')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await expect(word).toHaveAttribute('data-review-hint-level', '1')
  await expect(word).toHaveAttribute('data-review-hint-failures', '2')
  await expect(word).toHaveAttribute('data-review-forced-reveal', '0,2')
  await expect(word).toHaveAttribute('data-review-audio', 'automatic')
  await expect(word).toHaveAttribute('data-review-phonetic', 'visible')
  await expect(word).toHaveText('c_n_e_')

  // fail #3 -> Full Answer immediately. No extra Hint-2 retry budget.
  await page.keyboard.type('cx')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await expect(word).toHaveAttribute('data-review-hint-level', '3')
  await expect(word).toHaveAttribute('data-review-hint-stage', 'hint-3')
  await expect(word).toHaveAttribute('data-review-hint-failures', '3')
  await expect(word).toHaveText('cancel')

  await page.keyboard.type('cancel')

  await expect
    .poll(async () => {
      const records = await readReviewWordRecords(page, ['cancel'])
      const latest = records[records.length - 1] as {
        learningContext?: {
          coldProbeEvidence?: {
            retrievalValidity?: string
          }
          reviewHint?: {
            maxLevel?: number
            coldProbeSurrendered?: boolean
            advanceCount?: number
            failureCount?: number
            hintPosition?: number
            autoHint0Triggered?: boolean
          }
        }
        reviewRatingDecision?: {
          eligible?: boolean
          reasonCodes?: string[]
        }
      }
      return {
        hint: latest?.learningContext?.reviewHint,
        frozen:
          latest?.learningContext?.coldProbeEvidence
            ?.retrievalValidity,
        eligible:
          latest?.reviewRatingDecision?.eligible,
        frozenReason:
          latest?.reviewRatingDecision?.reasonCodes?.includes(
            'cold-probe-failure-frozen',
          ),
      }
    })
    .toMatchObject({
      hint: {
        maxLevel: 3,
        coldProbeSurrendered: false,
        advanceCount: 3,
        failureCount: 3,
        hintPosition: 2,
        autoHint0Triggered: true,
      },
      frozen: 'independent',
      eligible: true,
      frozenReason: true,
    })
})

test('invalid persisted Learn session self-heals through the single Learn controller', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({ isReviewMode: false }),
    )
  })

  await page.goto('/learn')
  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.getByRole('button', { name: 'Learn', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('按任意键开始')).toBeVisible()

  const info = await readReviewModeInfo(page)
  expect(info?.isReviewMode).toBe(true)
  expect(info?.reviewRecord?.isFinished).toBe(false)
  expect(info?.reviewRecord?.words?.length).toBeGreaterThan(0)
})

test('unfinished Learn session survives reload without cursor reset or duplication', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async ({ words }) => {
    const record = {
      id: 910001,
      dict: 'cet4',
      createTime: 910001,
      index: 1,
      isFinished: false,
      sessionKind: 'review',
      words,
    }

    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(2))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({
        isReviewMode: true,
        reviewRecord: record,
      }),
    )

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewRecords', 'readwrite')
        tx.objectStore('reviewRecords').clear()
        tx.objectStore('reviewRecords').put(record)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }
    })
  }, { words: reviewWords })

  await page.goto('/learn')
  await waitForRenderedWord(page, 'analyse')

  const before = await readReviewModeInfo(page)
  expect(before?.reviewRecord?.id).toBe(910001)
  expect(before?.reviewRecord?.index).toBe(1)

  await page.reload()
  await expect(page).toHaveURL(/\/learn$/)
  await waitForRenderedWord(page, 'analyse')

  const after = await readReviewModeInfo(page)
  expect(after?.reviewRecord?.id).toBe(910001)
  expect(after?.reviewRecord?.index).toBe(1)
  expect(
    await page.evaluate(() => localStorage.getItem('currentChapter')),
  ).toBe(JSON.stringify(2))

  const count = await page.evaluate(async () => {
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewRecords', 'readonly')
        const result = tx.objectStore('reviewRecords').count()
        result.onerror = () => reject(result.error)
        result.onsuccess = () => {
          resolve(result.result)
          db.close()
        }
      }
    })
  })
  expect(count).toBe(1)
})

test('Space is ordinary spelling input while ESC is the only explicit surrender', async ({
  page,
}) => {
  await seedReviewSession(page, reviewWords.slice(0, 1), 910002)
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const word = page.locator('[data-typing-word="cancel"]')
  const translation = page.locator('[data-typing-translation]')
  await expect(word).toHaveAttribute('data-review-hint-level', 'cold')
  await expect(word).toHaveText('______')
  await expect(translation).toHaveAttribute(
    'data-typing-translation',
    'visible',
  )

  // Space is no longer a special "I don't know" command. For this single
  // word it is simply an ordinary wrong spelling key, so it consumes fail #1
  // and enters Minimal Hint rather than surrendering to Full Answer.
  await page.keyboard.press('Space')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await expect(word).toHaveAttribute('data-review-hint-level', '0')
  await expect(word).toHaveAttribute('data-review-hint-failures', '1')
  await expect(word).toHaveAttribute('data-review-hint-position', '0')
  await expect(word).toHaveText('c_____')

  // ESC is the explicit surrender and jumps directly to Full Answer.
  await page.keyboard.type('ca')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .not.toBe('')
  await page.keyboard.press('Escape')

  await expect(word).toHaveAttribute('data-review-hint-level', '3')
  await expect(word).toHaveAttribute('data-review-hint-stage', 'hint-3')
  await expect(word).toHaveText('cancel')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
})

test('cold probe prefers masked example over translation and reveals translation after surrender', async ({
  page,
}) => {
  const contextualWord: ReviewWord = {
    ...reviewWords[0],
    example: [
      {
        en: 'He cancelled it.',
        cn: '他取消了这件事。',
        start: 3,
        end: 12,
      },
    ],
  }

  await seedReviewSession(page, [contextualWord], 910003)
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const example = page.locator('[data-typing-example="visible"]')
  const translation = page.locator('[data-typing-translation]')
  await expect(example).toBeVisible()
  await expect(example).toHaveAttribute(
    'data-typing-example-revealed',
    'false',
  )
  await expect(example).toContainText('He _________ it.')
  await expect(
    example.locator('[data-typing-example-cn="visible"]'),
  ).toHaveText('他取消了这件事。')
  await expect(translation).toHaveAttribute('data-typing-translation', 'hidden')

  await page.keyboard.press('Escape')

  await expect(translation).toHaveAttribute('data-typing-translation', 'visible')
})

test('Learn weak review pressure does not silently override the configured daily target', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({ isReviewMode: false }),
    )

    const now = Math.floor(Date.now() / 1000)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(
          ['wordRecords', 'reviewWordStates', 'reviewRecords'],
          'readwrite',
        )
        tx.objectStore('reviewRecords').clear()

        for (let index = 0; index < 8; index += 1) {
          const word = `quota-history-${index}`
          const isAgain = index < 4
          tx.objectStore('wordRecords').add({
            word,
            timeStamp: now - index * 60,
            dict: 'cet4',
            chapter: -1,
            timing: [],
            wrongCount: isAgain ? 1 : 0,
            mistakes: isAgain ? { 0: ['x'] } : {},
            sourceMode: 'learn',
            learnItemKind: 'review',
            reviewRatingDecision: isAgain
              ? {
                  eligible: true,
                  rating: 'again',
                  confidence: 1,
                  reasonCodes: ['p3-e2e-again'],
                }
              : {
                  eligible: true,
                  rating: 'good',
                  confidence: 1,
                  reasonCodes: ['p3-e2e-good'],
                },
          })
          tx.objectStore('reviewWordStates').put({
            dict: 'cet4',
            word,
            createdAt: now - 86400,
            updatedAt: now,
            lastReviewedAt: now,
            nextReviewAt: now + 86400,
            reviewCount: 1,
            lapseCount: isAgain ? 1 : 0,
            cleanStreak: isAgain ? 0 : 1,
            lastOutcome: isAgain ? 'again' : 'good',
            lifecycle: 'active',
            stateVersion: 4,
            schedulerState: {
              kind: 'basic-v2',
              stage: 1,
              intervalDays: 1,
            },
          })
        }

        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }
    })
  })

  await page.goto('/learn')
  const info = await waitForActiveLearnSession(page)
  expect(info?.reviewRecord?.sessionKind).toBe('acquisition')
  // Weak memory signals remain diagnostics, but the explicit daily target is
  // 32 and a single internal Block remains capped at 20.
  expect(info?.reviewRecord?.words).toHaveLength(20)
})


test('Learn workload budget is advisory and does not shrink the configured daily target', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({ isReviewMode: false }),
    )

    const now = Math.floor(Date.now() / 1000)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(
          ['wordRecords', 'reviewWordStates', 'reviewRecords'],
          'readwrite',
        )
        tx.objectStore('reviewRecords').clear()

        for (let index = 0; index < 10; index += 1) {
          const word = `p4-history-${index}`
          tx.objectStore('wordRecords').add({
            word,
            timeStamp: now - index * 60,
            dict: 'cet4',
            chapter: -1,
            timing: [],
            wrongCount: 0,
            mistakes: {},
            sourceMode: 'learn',
            learnItemKind: 'review',
            typingTelemetry: {
              telemetryVersion: 2,
              firstKeyLatencyMs: 10000,
              attempts: [
                {
                  startLatencyMs: 10000,
                  durationMs: 80000,
                  correctPrefixLength: 4,
                  result: 'clean',
                },
              ],
            },
            reviewRatingDecision: {
              eligible: true,
              rating: 'good',
              confidence: 1,
              reasonCodes: ['p4-e2e-good'],
            },
          })
          tx.objectStore('reviewWordStates').put({
            dict: 'cet4',
            word,
            createdAt: now - 86400,
            updatedAt: now,
            lastReviewedAt: now,
            nextReviewAt: now + 86400,
            reviewCount: 1,
            lapseCount: 0,
            cleanStreak: 1,
            lastOutcome: 'good',
            lifecycle: 'active',
            stateVersion: 4,
            schedulerState: {
              kind: 'basic-v2',
              stage: 1,
              intervalDays: 1,
            },
          })
        }

        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }
    })
  })

  await page.goto('/learn')
  const info = await waitForActiveLearnSession(page)
  expect(info?.reviewRecord?.sessionKind).toBe('acquisition')
  // Fifteen minutes of prior effort may affect diagnostics, but it must not
  // silently reduce the explicit 32-new-word DailySession target.
  expect(info?.reviewRecord?.words).toHaveLength(20)
})


test('backup/cloud snapshot round-trip preserves FSRS and Learn durable state', async ({
  page,
}) => {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect(page.getByText('backup harness ready')).toBeVisible()

  await page.evaluate(async () => {
    await (window as any).__backupHarness.seed()
  })

  const tableContract = await page.evaluate(async () => {
    return (window as any).__backupHarness.inspectTableContract()
  })
  expect(tableContract.manifest).toEqual([
    'achievementEvents',
    'achievementStates',
    'chapterRecords',
    'reviewRecords',
    'reviewWordStates',
    'wordRecords',
  ])
  expect(tableContract.runtime).toEqual(tableContract.manifest)
  expect(tableContract.exported).toEqual(tableContract.manifest)

  const backupJson = await page.evaluate(async () => {
    return (window as any).__backupHarness.exportBackupJson()
  })

  await page.evaluate(async () => {
    await (window as any).__backupHarness.poisonBeforeRestore()
  })

  await page.evaluate(async (json) => {
    await (window as any).__backupHarness.importBackupJson(json)
  }, backupJson)

  const offline = await page.evaluate(async () => {
    return (window as any).__backupHarness.inspect()
  })

  expect(offline.wordRecord?.fsrsShadow?.libraryVersion).toBe('5.4.2')
  expect(offline.wordRecord?.fsrsShadow?.algorithmModel).toBe('fsrs-6')
  expect(offline.wordRecord?.fsrsShadow?.retrievabilityBefore).toBe(0.82)
  expect(
    offline.wordRecord?.fsrsShadow?.counterfactual?.easy?.intervalDays,
  ).toBe(14)
  expect(offline.reviewWordState?.schedulerState).toEqual({
    kind: 'basic-v2',
    stage: 4,
    intervalDays: 14,
  })
  expect(offline.reviewRecord?.isFinished).toBe(false)
  expect(offline.reviewRecord?.sessionKind).toBe('review')
  expect(offline.reviewRecord?.reinforcementCounts?.['backup-fsrs-word']).toBe(
    1,
  )
  expect(offline.currentDict).toBe('cet4')
  expect(offline.currentChapter).toBe(3)
  expect(offline.reviewModeInfo).toEqual({ isReviewMode: false })
  expect(offline.achievementEvent).toMatchObject({
    eventId: 'backup-achievement-event',
    eventType: 'word_mastered',
    origin: 'live',
    sourceRecordId: offline.wordRecord?.id,
    sessionId: 'backup-session',
    dict: 'cet4',
    word: 'backup-fsrs-word',
    unlockedAchievementIds: ['ACH_BACKUP_ROUNDTRIP'],
  })
  expect(offline.achievementState).toMatchObject({
    achievementId: 'ACH_BACKUP_ROUNDTRIP',
    firstTriggerEventId: 'backup-achievement-event',
    sourceRecordId: offline.wordRecord?.id,
    sessionId: 'backup-session',
  })

  const snapshot = await page.evaluate(async () => {
    return (window as any).__backupHarness.createLocalSnapshot()
  })

  await page.evaluate(async () => {
    await (window as any).__backupHarness.poisonBeforeRestore()
  })

  const restored = await page.evaluate(async (input) => {
    return (window as any).__backupHarness.restoreLocalSnapshot(
      input.payloadBase64,
      input.clientFormatVersion,
    )
  }, snapshot)

  const cloudClient = await page.evaluate(async () => {
    return (window as any).__backupHarness.inspect()
  })

  expect(restored.fingerprint).toBe(snapshot.fingerprint)
  expect(cloudClient.wordRecord?.fsrsShadow).toEqual(
    offline.wordRecord?.fsrsShadow,
  )
  expect(cloudClient.reviewWordState?.schedulerState).toEqual(
    offline.reviewWordState?.schedulerState,
  )
  expect(cloudClient.reviewRecord?.isFinished).toBe(false)
  expect(cloudClient.currentDict).toBe('cet4')
  expect(cloudClient.currentChapter).toBe(3)
  expect(cloudClient.reviewModeInfo).toEqual({ isReviewMode: false })
  expect(cloudClient.achievementEvent).toEqual(
    offline.achievementEvent,
  )
  expect(cloudClient.achievementState).toEqual(
    offline.achievementState,
  )

  await page.evaluate(async () => {
    await (window as any).__backupHarness.clearAllTables()
    localStorage.removeItem('currentDict')
    localStorage.removeItem('currentChapter')
    localStorage.removeItem('reviewModeInfo')
  })
})


test('finished Learn session rejects duplicate evidence even if a stale route renders its word', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const word = {
      name: 'cancel',
      trans: ['取消'],
      usphone: 'kænsl',
      ukphone: 'kænsl',
    }
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(-1))
    localStorage.setItem(
      'developerDiagnosticsConfig',
      JSON.stringify({ isOpen: true }),
    )
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({
        isReviewMode: true,
        reviewRecord: {
          id: 900088,
          dict: 'cet4',
          createTime: 900088,
          index: 0,
          isFinished: true,
          sessionKind: 'review',
          words: [word],
          exercisePlans: {
            cancel: {
              version: 1,
              condition: {
                version: 1,
                purpose: 'probe',
                source: 'adaptive-policy',
                audio: 'none',
                meaning: 'visible',
                phonetic: 'hidden',
                letters: { mode: 'all-hidden' },
                probeDimension: 'none',
              },
              decision: {
                version: 1,
                policyVersion: 'canonical-review-probe-v1',
                reasonCodes: ['terminal-immutability-regression'],
                conditionVersion: 1,
              },
              sourceShadowVersion: 1,
            },
          },
        },
      }),
    )
    localStorage.setItem(
      'pronunciation',
      JSON.stringify({
        isOpen: false,
        volume: 1,
        type: 'us',
        name: '美音',
        isLoop: false,
        isTransRead: false,
        transVolume: 1,
        rate: 1,
      }),
    )
  })

  // /typing deliberately bypasses root route admission to emulate a future
  // stale-route bug rendering a terminal record.
  await page.goto('/typing')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  await page.keyboard.type('cancel')

  await expect(
    page.locator('[data-learn-result-screen]'),
  ).toBeVisible({ timeout: 5_000 })

  const records = await readReviewWordRecords(page, ['cancel'])
  expect(records).toHaveLength(0)

  const trace = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem('qwertyDeveloperTraceV1') ?? '[]',
    ),
  )
  expect(
    trace.some(
      (event: { event?: string }) =>
        event.event === 'finished-session-word-record-blocked',
    ),
  ).toBe(true)
  expect(
    trace.some(
      (event: { event?: string }) =>
        event.event === 'finished-session-completion-blocked',
    ),
  ).toBe(true)
})

test('desktop resize after Learn completion cannot resurrect the finished last word', async ({
  page,
}) => {
  await seedReviewSession(page, [reviewWords[0]], 900089)

  // The incident was observed from the root URL. Root admission must route an
  // active Learn checkpoint to the canonical Learn URL.
  await page.goto('/')
  await expect(page).toHaveURL(/\/learn$/)
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  await page.keyboard.type('cancel')

  const result = page.locator('[data-learn-result-screen]')
  await expect(result).toBeVisible({ timeout: 5_000 })

  const viewport = page.viewportSize() ?? {
    width: 1280,
    height: 720,
  }
  await page.setViewportSize({
    width: Math.max(900, viewport.width - 80),
    height: Math.max(650, viewport.height - 40),
  })

  // Desktop -> desktop resize must be presentation-only. It must not navigate
  // through "/" and remount Typing with reducer isFinished=false.
  await expect(page).toHaveURL(/\/learn$/)
  await expect(result).toBeVisible()
  await expect(
    page.locator('[data-typing-word="cancel"]'),
  ).toHaveCount(0)

  const info = await readReviewModeInfo(page)
  expect(info?.reviewRecord?.isFinished).toBe(true)
})

test('final Learn word reaches result UI even when route-cache persistence throws', async ({
  page,
}) => {
  await seedReviewSession(page, [reviewWords[0]], 900090)

  await page.addInitScript(() => {
    const nativeSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function patchedSetItem(
      key: string,
      value: string,
    ) {
      if (
        key === 'reviewModeInfo' &&
        sessionStorage.getItem(
          'qwerty:e2e:fail-review-mode-write',
        ) === '1'
      ) {
        throw new DOMException(
          'Injected reviewModeInfo write failure',
          'QuotaExceededError',
        )
      }
      return nativeSetItem.call(this, key, value)
    }
  })

  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  await page.evaluate(() => {
    sessionStorage.setItem(
      'qwerty:e2e:fail-review-mode-write',
      '1',
    )
  })

  await page.keyboard.type('cancel')

  // The UI terminal transition is safety-critical and must not depend on a
  // route-cache write succeeding.
  await expect(
    page.locator('[data-learn-result-screen]'),
  ).toBeVisible({ timeout: 5_000 })

  // The serialized IndexedDB checkpoint was queued before the route-cache
  // failure and still converges to the terminal state.
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        return new Promise<boolean>((resolve, reject) => {
          const request = indexedDB.open('RecordDB')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction(
              'reviewRecords',
              'readonly',
            )
            const get = tx
              .objectStore('reviewRecords')
              .get(900090)
            get.onerror = () => reject(get.error)
            get.onsuccess = () => {
              resolve(get.result?.isFinished === true)
              db.close()
            }
          }
        })
      }),
    )
    .toBe(true)
})


test('visible first-acquisition copy never auto-enters the hint ladder after repeated mistakes', async ({
  page,
}) => {
  await seedAcquisitionSession(
    page,
    [reviewWords[0]],
    900091,
    'exposure',
  )
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const acquisition = page.locator(
    '[data-learn-acquisition-phase="exposure"]',
  )
  const word = page.locator('[data-typing-word="cancel"]')
  await expect(acquisition).toBeVisible()
  await expect(word).toHaveAttribute(
    'data-review-letters',
    'all-visible',
  )

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.keyboard.press('x')
    await page.waitForTimeout(350)
  }

  await expect(word).toHaveAttribute(
    'data-review-hint-level',
    'cold',
  )
  await expect(word).toHaveAttribute(
    'data-review-letters',
    'all-visible',
  )
  await expect(
    page.getByRole('button', { name: 'Skip', exact: true }),
  ).toHaveCount(0)

  await page.keyboard.type('cancel')
  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return info?.reviewRecord?.index
    })
    .toBeGreaterThan(0)
})
