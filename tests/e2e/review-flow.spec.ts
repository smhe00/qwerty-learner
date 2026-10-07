// RC 2026-09-30 review-formal-gate-v1 production acceptance marker
import { expect, test } from '@playwright/test'
import {
  putDueReviewWordState,
  readReviewGateState,
  readReviewModeInfo,
  readReviewWordRecords,
  reviewWords,
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

