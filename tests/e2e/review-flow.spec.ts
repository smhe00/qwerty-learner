// RC 2026-09-30 review-formal-gate-v1 production acceptance marker
import { expect, test } from '@playwright/test'

type ReviewWord = {
  name: string
  trans: string[]
  usphone: string
  ukphone: string
}

const reviewWords: ReviewWord[] = [
  {
    name: 'cancel',
    trans: ['取消'],
    usphone: 'kænsl',
    ukphone: 'kænsl',
  },
  {
    name: 'analyse',
    trans: ['分析'],
    usphone: 'ænəlaɪz',
    ukphone: 'ænəlaɪz',
  },
  {
    name: 'numerous',
    trans: ['众多的'],
    usphone: 'numərəs',
    ukphone: 'njuːmərəs',
  },
]

async function seedReviewSession(
  page: import('@playwright/test').Page,
  words: ReviewWord[],
  id: number,
) {
  await page.addInitScript(
    ({ seededWords, recordId }) => {
      localStorage.setItem('currentDict', JSON.stringify('cet4'))
      localStorage.setItem('currentChapter', JSON.stringify(-1))
      localStorage.setItem(
        'reviewModeInfo',
        JSON.stringify({
          isReviewMode: true,
          reviewRecord: {
            id: recordId,
            dict: 'cet4',
            createTime: 1,
            index: 0,
            isFinished: false,
            words: seededWords,
            exercisePlans: Object.fromEntries(
              seededWords.map((word) => [
                word.name,
                {
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
                    reasonCodes: [
                      'canonical-long-term-probe',
                      'meaning-to-orthography',
                      'letters-hidden',
                      'audio-off',
                      'phonetic-hidden',
                    ],
                    conditionVersion: 1,
                  },
                  sourceShadowVersion: 1,
                },
              ]),
            ),
          },
        }),
      )
      localStorage.setItem(
        'loopWordConfig',
        JSON.stringify({ times: 1 }),
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
    },
    { seededWords: words, recordId: id },
  )
}

async function readReviewModeInfo(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('reviewModeInfo')
    return raw ? JSON.parse(raw) : undefined
  })
}

async function waitForReviewIndex(
  page: import('@playwright/test').Page,
  index: number,
) {
  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return info?.reviewRecord?.index
    })
    .toBe(index)
}

async function waitForRenderedWord(
  page: import('@playwright/test').Page,
  word: string,
) {
  await expect(page.locator(`[data-typing-word="${word}"]`)).toBeVisible()
}


async function readRenderedAttemptState(
  page: import('@playwright/test').Page,
  word: string,
) {
  const locator = page.locator(`[data-typing-word="${word}"]`)
  return {
    word,
    input: await locator.getAttribute('data-typing-input'),
    acceptedLength: await locator.getAttribute('data-typing-accepted-length'),
    targetLength: await locator.getAttribute('data-typing-target-length'),
    locked: await locator.getAttribute('data-typing-locked'),
    hasWrong: await locator.getAttribute('data-typing-has-wrong'),
    finished: await locator.getAttribute('data-typing-finished'),
    active: await locator.getAttribute('data-typing-active'),
  }
}

async function startTyping(page: import('@playwright/test').Page) {
  await expect(page.getByText('按任意键开始')).toBeVisible()
  // The first legal key starts Typing and is intentionally not part of the word.
  await page.keyboard.press('a')
}

async function readReviewWordRecords(
  page: import('@playwright/test').Page,
  words: string[],
) {
  return page.evaluate(async (wantedWords) => {
    return new Promise<
      Array<{
        word: string
        wrongCount: number
        mistakes: Record<string, string[]>
        typingTelemetry?: {
          attempts?: Array<{ wrongIndex?: number; result: string }>
        }
        reviewRatingDecision?: {
          eligible?: boolean
          rating?: string | null
          reason?: string
        }
      }>
    >((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('wordRecords', 'readonly')
        const all = tx.objectStore('wordRecords').getAll()
        all.onerror = () => reject(all.error)
        all.onsuccess = () => {
          resolve(
            all.result.filter(
              (record) =>
                record.chapter === -1 &&
                wantedWords.includes(record.word),
            ),
          )
          db.close()
        }
      }
    })
  }, words)
}

async function putDueReviewWordState(
  page: import('@playwright/test').Page,
  word: string,
) {
  return page.evaluate(async (targetWord) => {
    const now = Math.floor(Date.now() / 1000)
    const state = {
      dict: 'cet4',
      word: targetWord,
      createdAt: now - 172_800,
      updatedAt: now - 86_400,
      lastReviewedAt: now - 86_400,
      nextReviewAt: now - 1,
      reviewCount: 1,
      lapseCount: 0,
      cleanStreak: 1,
      lastOutcome: 'good',
      lifecycle: 'active',
      stateVersion: 4,
      schedulerState: {
        kind: 'basic-v1',
        stage: 0,
        intervalDays: 1,
      },
    }

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewWordStates', 'readwrite')
        tx.objectStore('reviewWordStates').put(state)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
      }
    })

    return state
  }, word)
}

async function readReviewGateState(
  page: import('@playwright/test').Page,
  word: string,
) {
  return page.evaluate(async (targetWord) => {
    return new Promise<{
      state?: {
        nextReviewAt?: number
        reviewCount?: number
        lapseCount?: number
        lastOutcome?: string
        stage?: number
        schedulerKind?: string
        intervalDays?: number
      }
      decision?: {
        eligible?: boolean
        rating?: string | null
        reason?: string
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
          const state = states.result.find(
            (item) => item.dict === 'cet4' && item.word === targetWord,
          )
          const record = [...records.result]
            .reverse()
            .find(
              (item) =>
                item.dict === 'cet4' &&
                item.word === targetWord &&
                item.chapter === -1,
            )
          resolve({
            state: state
              ? {
                  nextReviewAt: state.nextReviewAt,
                  reviewCount: state.reviewCount,
                  lapseCount: state.lapseCount,
                  lastOutcome: state.lastOutcome,
                  stage: state.schedulerState?.stage,
                  schedulerKind: state.schedulerState?.kind,
                  intervalDays: state.schedulerState?.intervalDays,
                }
              : undefined,
            decision: record?.reviewRatingDecision,
          })
          db.close()
        }
      }
    })
  }, word)
}

async function seedReviewAdmissionCase(
  page: import('@playwright/test').Page,
  options: { freshLearningAfterReview: boolean },
) {
  await page.goto('/')

  await page.evaluate(async ({ freshLearningAfterReview }) => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    const now = Math.floor(Date.now() / 1000)
    const reviewTime = now - 120
    const learningTime = freshLearningAfterReview
      ? now - 60
      : now - 180

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(
          ['wordRecords', 'reviewWordStates', 'reviewRecords'],
          'readwrite',
        )

        tx.objectStore('wordRecords').add({
          word: 'cancel',
          timeStamp: learningTime,
          dict: 'cet4',
          chapter: 0,
          timing: [],
          wrongCount: 1,
          mistakes: { 0: ['x'] },
        })
        tx.objectStore('wordRecords').add({
          word: 'cancel',
          timeStamp: reviewTime,
          dict: 'cet4',
          chapter: -1,
          timing: [],
          wrongCount: 0,
          mistakes: {},
        })
        tx.objectStore('reviewWordStates').put({
          dict: 'cet4',
          word: 'cancel',
          createdAt: reviewTime,
          updatedAt: reviewTime,
          lastReviewedAt: reviewTime,
          nextReviewAt: now + 86_400,
          reviewCount: 1,
          lapseCount: 0,
          cleanStreak: 1,
          lastOutcome: 'good',
          stateVersion: 4,
          schedulerState: {
            kind: 'basic-v1',
            stage: 0,
            intervalDays: 1,
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
  }, options)

  await page.goto('/gallery')
  await page.getByText('CET-4', { exact: true }).first().click()
  await expect(page.getByText('章节选择', { exact: true })).toBeVisible()
  await page.getByText('长期学习', { exact: true }).click()
  await expect(page.getByText('当前词典错词数: 1')).toBeVisible()
}

test('multi-word Review advances through every rendered word and finishes', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await seedReviewSession(page, reviewWords, 900001)
  await page.goto('/')
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
  expect(pageErrors).toEqual([])
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
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await expect(page).toHaveURL(/\/learn\/session$/)

  const info = await readReviewModeInfo(page)
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

  await expect(page).toHaveURL(/\/learn\/session$/)
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
  await page.getByRole('button', {
    name: '开始',
    exact: true,
  }).click()
  await expect(page).toHaveURL(/\/learn\/session$/)

  const sessionInfo = await readReviewModeInfo(page)
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
      const info = await readReviewModeInfo(page)
      return info?.reviewRecord?.isFinished
    })
    .toBe(true)

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
  await seedReviewSession(page, reviewWords.slice(0, 1), 900004)
  await page.goto('/')
  const before = await putDueReviewWordState(page, 'cancel')

  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  await page.keyboard.type('cancel')

  await expect
    .poll(async () => {
      const result = await readReviewGateState(page, 'cancel')
      return (
        result.state?.reviewCount === 2 &&
        result.decision?.eligible === true &&
        result.state?.lastOutcome === result.decision.rating
      )
    })
    .toBe(true)

  const after = await readReviewGateState(page, 'cancel')
  expect(['hard', 'good', 'easy']).toContain(after.decision?.rating)
  expect(after.state?.schedulerKind).toBe('basic-v2')
  expect(after.state?.nextReviewAt).toBeGreaterThan(before.nextReviewAt)
})

test('Phase D live gate persists assisted Hint evidence but leaves scheduler unchanged', async ({
  page,
}) => {
  await seedReviewSession(page, reviewWords.slice(0, 1), 900005)
  await page.goto('/')
  const before = await putDueReviewWordState(page, 'cancel')

  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')
  const word = page.locator('[data-typing-word="cancel"]')

  await page.keyboard.type('cax')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await page.keyboard.type('cax')
  await expect(word).toHaveAttribute('data-review-hint-level', '0')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')

  await page.keyboard.type('cancel')

  await expect
    .poll(async () => {
      const result = await readReviewGateState(page, 'cancel')
      return {
        reviewCount: result.state?.reviewCount,
        nextReviewAt: result.state?.nextReviewAt,
        lastOutcome: result.state?.lastOutcome,
        eligible: result.decision?.eligible,
        reason: result.decision?.reason,
      }
    })
    .toEqual({
      reviewCount: before.reviewCount,
      nextReviewAt: before.nextReviewAt,
      lastOutcome: before.lastOutcome,
      eligible: false,
      reason: 'training-event',
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
  await page.keyboard.press('Space')
  await expect(cancel).toHaveAttribute('data-review-hint-level', '0')
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

test('Hint 3 skip lock blocks navigation to a real next Review word', async ({
  page,
}) => {
  await seedReviewSession(page, reviewWords.slice(0, 2), 900010)
  await page.goto('/')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const cancel = page.locator('[data-typing-word="cancel"]')
  for (let level = 0; level <= 3; level += 1) {
    await page.keyboard.press('Space')
    await expect(cancel).toHaveAttribute(
      'data-review-hint-level',
      String(level),
    )
  }

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


test('Typing and Learn are explicit top-level modes', async ({ page }) => {
  await page.goto('/typing')

  const typingMode = page.getByRole('button', { name: 'Typing', exact: true })
  const learnMode = page.getByRole('button', { name: 'Learn', exact: true })

  await expect(typingMode).toHaveAttribute('aria-pressed', 'true')
  await expect(learnMode).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: '开始' })).toBeVisible()

  await learnMode.click()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.getByRole('button', { name: 'Learn', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: '开始', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('今日到期', { exact: true })).toHaveCount(0)
  await expect(page.getByText('学习计划', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Typing', exact: true }).click()
  await expect(page).toHaveURL(/\/typing$/)
  await expect(
    page.getByRole('button', { name: 'Typing', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('Learn landing keeps long-term state while plan details stay hidden', async ({
  page,
}) => {
  await seedReviewAdmissionCase(page, {
    freshLearningAfterReview: false,
  })

  await page.goto('/learn')
  await expect(page.getByText('长期学习中', { exact: true })).toHaveCount(0)
  await expect(page.getByText('学习计划', { exact: true })).toHaveCount(0)

  const state = await page.evaluate(async () => {
    return new Promise<{
      lifecycle?: string
      reviewCount?: number
      nextReviewAt?: number
    } | null>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewWordStates', 'readonly')
        const all = tx.objectStore('reviewWordStates').getAll()
        all.onerror = () => reject(all.error)
        all.onsuccess = () => {
          const match = all.result.find(
            (item) => item.dict === 'cet4' && item.word === 'cancel',
          )
          resolve(
            match
              ? {
                  lifecycle: match.lifecycle,
                  reviewCount: match.reviewCount,
                  nextReviewAt: match.nextReviewAt,
                }
              : null,
          )
          db.close()
        }
      }
    })
  })

  expect(state).toMatchObject({
    reviewCount: 1,
  })
  expect(state?.lifecycle ?? 'active').toBe('active')
})

test('current Learn item can be excluded without using Skip', async ({ page }) => {
  await seedReviewSession(page, reviewWords.slice(0, 2), 900020)
  await page.goto('/learn/session')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('移出学习计划')
    await dialog.accept()
  })

  await page.getByRole('button', { name: 'Learn 单词菜单' }).click()
  await page.getByRole('button', { name: '移出学习计划' }).click()

  await waitForRenderedWord(page, 'analyse')
  await expect(
    page.locator('[data-typing-word="cancel"]'),
  ).toHaveCount(0)

  const state = await page.evaluate(async () => {
    return new Promise<{ lifecycle?: string } | null>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewWordStates', 'readonly')
        const all = tx.objectStore('reviewWordStates').getAll()
        all.onerror = () => reject(all.error)
        all.onsuccess = () => {
          const match = all.result.find(
            (item) => item.dict === 'cet4' && item.word === 'cancel',
          )
          resolve(match ? { lifecycle: match.lifecycle } : null)
          db.close()
        }
      }
    })
  })

  expect(state?.lifecycle).toBe('excluded')
})


test('Learn dictionary selection reuses the Typing gallery and skips chapter selection', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
  })

  await page.goto('/learn')
  await page.getByRole('link', { name: 'CET-4', exact: true }).click()
  await expect(page).toHaveURL(/\/gallery\?mode=learn$/)

  const target = page.getByRole('button', {
    name: '选择 Learn 词库：中考核心词',
  })
  await expect(target).toBeVisible()
  await target.click()

  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.getByRole('link', { name: '中考核心词', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('章节选择', { exact: true })).toHaveCount(0)
})

test('Learn header keeps dictionary, Start, and Settings aligned with Typing', async ({
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

  await page.goto('/typing')
  const typingDictionary = page.getByRole('link', {
    name: 'CET-4',
    exact: true,
  })
  const typingStart = page.getByRole('button', {
    name: '开始',
    exact: true,
  })
  const typingSetting = page.getByTitle('打开设置对话框')

  await expect(typingDictionary).toBeVisible()
  await expect(typingStart).toBeVisible()
  await expect(typingSetting).toBeVisible()

  const typingPositions = {
    dictionary: (await typingDictionary.boundingBox())?.x ?? 0,
    start: (await typingStart.boundingBox())?.x ?? 0,
    setting: (await typingSetting.boundingBox())?.x ?? 0,
  }

  await page.goto('/learn')
  const learnDictionary = page.getByRole('link', {
    name: 'CET-4',
    exact: true,
  })
  const learnStart = page.getByRole('button', {
    name: '开始',
    exact: true,
  })
  const learnSetting = page.getByTitle('打开设置对话框')

  await expect(learnDictionary).toBeVisible()
  await expect(learnStart).toBeVisible()
  await expect(learnSetting).toBeVisible()

  const learnPositions = {
    dictionary: (await learnDictionary.boundingBox())?.x ?? 0,
    start: (await learnStart.boundingBox())?.x ?? 0,
    setting: (await learnSetting.boundingBox())?.x ?? 0,
  }

  expect(
    Math.abs(learnPositions.dictionary - typingPositions.dictionary),
  ).toBeLessThanOrEqual(4)
  expect(
    Math.abs(learnPositions.start - typingPositions.start),
  ).toBeLessThanOrEqual(24)
  expect(
    Math.abs(learnPositions.setting - typingPositions.setting),
  ).toBeLessThanOrEqual(24)

  await expect(page.getByText('今日到期', { exact: true })).toHaveCount(0)
  await expect(page.getByText('学习计划', { exact: true })).toHaveCount(0)
})

test('Learn reuses Typing controls while preserving Typing-owned preferences', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(2))
    localStorage.setItem(
      'loopWordConfig',
      JSON.stringify({ times: 3 }),
    )
    localStorage.setItem(
      'wordDictationConfig',
      JSON.stringify({
        isOpen: true,
        type: 'hideVowel',
        openBy: 'user',
      }),
    )
    localStorage.setItem(
      'typingTransVisible',
      JSON.stringify(false),
    )
    localStorage.setItem(
      'pronunciation',
      JSON.stringify({
        isOpen: true,
        volume: 1,
        type: 'uk',
        name: '英音',
        isLoop: false,
        isTransRead: false,
        transVolume: 1,
        rate: 1,
      }),
    )
    localStorage.setItem(
      'phoneticConfig',
      JSON.stringify({ isOpen: true, type: 'uk' }),
    )
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({ isReviewMode: false }),
    )

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const names = [
          'wordRecords',
          'reviewWordStates',
          'reviewRecords',
        ]
        const tx = db.transaction(names, 'readwrite')
        for (const name of names) {
          tx.objectStore(name).clear()
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

  await page.goto('/typing')
  await expect(
    page.getByRole('button', { name: '第 3 章', exact: true }),
  ).toBeVisible()

  const before = await page.evaluate(() => ({
    chapter: localStorage.getItem('currentChapter'),
    loop: localStorage.getItem('loopWordConfig'),
    dictation: localStorage.getItem('wordDictationConfig'),
    trans: localStorage.getItem('typingTransVisible'),
    pronunciation: localStorage.getItem('pronunciation'),
    phonetic: localStorage.getItem('phoneticConfig'),
  }))

  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)

  await expect(
    page.getByRole('button', {
      name: '章节切换（Learn 模式禁用）',
      exact: true,
    }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', {
      name: '选择单词的循环次数',
      exact: true,
    }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', {
      name: '开关默写模式',
      exact: true,
    }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', {
      name: /开关释义显示/,
    }),
  ).toBeDisabled()

  const pronunciationButton = page
    .getByRole('button', { name: '英音', exact: true })
    .first()
  await expect(pronunciationButton).toBeEnabled()
  await pronunciationButton.click()
  await expect(
    page.getByText('单词发音口音', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  const soundButton = page.getByRole('button', {
    name: '音效设置',
    exact: true,
  })
  await expect(soundButton).toBeEnabled()
  await soundButton.click()
  await expect(
    page.getByText('开关按键音', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  const afterLanding = await page.evaluate(() => ({
    chapter: localStorage.getItem('currentChapter'),
    loop: localStorage.getItem('loopWordConfig'),
    dictation: localStorage.getItem('wordDictationConfig'),
    trans: localStorage.getItem('typingTransVisible'),
    pronunciation: localStorage.getItem('pronunciation'),
    phonetic: localStorage.getItem('phoneticConfig'),
  }))
  expect(afterLanding).toEqual(before)

  const startButton = page.getByRole('button', {
    name: '开始',
    exact: true,
  })
  await expect(startButton).toBeEnabled()
  await startButton.click()
  await expect(page).toHaveURL(/\/learn\/session$/)

  expect(
    await page.evaluate(() =>
      localStorage.getItem('currentChapter'),
    ),
  ).toBe(before.chapter)

  const info = await readReviewModeInfo(page)
  const firstWord = info?.reviewRecord?.words?.[0]?.name as string
  await startTyping(page)
  await waitForRenderedWord(page, firstWord)
  const rendered = page.locator(
    `[data-typing-word="${firstWord}"]`,
  )
  await expect(rendered).toHaveAttribute('data-review-audio', 'none')
  await expect(rendered).toHaveAttribute(
    'data-review-letters',
    'all-hidden',
  )
  await expect(rendered).toHaveAttribute(
    'data-review-phonetic',
    'hidden',
  )
  await expect(rendered).toHaveAttribute(
    'data-review-meaning',
    'visible',
  )

  await page.getByRole('button', { name: 'Typing', exact: true }).click()
  await expect(page).toHaveURL(/\/typing$/)
  await expect(
    page.getByRole('button', { name: '第 3 章', exact: true }),
  ).toBeVisible()

  const afterReturn = await page.evaluate(() => ({
    chapter: localStorage.getItem('currentChapter'),
    loop: localStorage.getItem('loopWordConfig'),
    dictation: localStorage.getItem('wordDictationConfig'),
    trans: localStorage.getItem('typingTransVisible'),
    pronunciation: localStorage.getItem('pronunciation'),
    phonetic: localStorage.getItem('phoneticConfig'),
  }))
  expect(afterReturn).toEqual(before)
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
  await expect(
    page.getByRole('button', { name: '继续学习', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '开始学习', exact: true }),
  ).toHaveCount(0)
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

  await page.getByRole('button', {
    name: '继续学习',
    exact: true,
  }).click()
  await expect(page).toHaveURL(/\/learn\/session$/)

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

test('Learn starts new acquisition only when there is no due review', async ({
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
        const names = [
          'wordRecords',
          'reviewWordStates',
          'reviewRecords',
        ]
        const tx = db.transaction(names, 'readwrite')
        for (const name of names) {
          tx.objectStore(name).clear()
        }

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

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        return new Promise<boolean>((resolve, reject) => {
          const request = indexedDB.open('RecordDB')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('reviewWordStates', 'readonly')
            const all = tx.objectStore('reviewWordStates').getAll()
            all.onerror = () => reject(all.error)
            all.onsuccess = () => {
              resolve(
                all.result.some(
                  (item) =>
                    item.dict === 'cet4' && item.word === 'cancel',
                ),
              )
              db.close()
            }
          }
        })
      })
    })
    .toBe(false)

  const startButton = page.getByRole('button', {
    name: '开始',
    exact: true,
  })
  await expect(startButton).toBeEnabled()
  await startButton.click()

  await expect(page).toHaveURL(/\/learn\/session$/)

  const info = await readReviewModeInfo(page)
  expect(info?.reviewRecord?.sessionKind).toBe('acquisition')
  expect(info?.reviewRecord?.words?.length).toBe(20)

  const firstWord = info?.reviewRecord?.words?.[0]?.name as string
  expect(firstWord).toBeTruthy()
  expect(
    info?.reviewRecord?.exercisePlans?.[firstWord],
  ).toMatchObject({
    condition: {
      purpose: 'probe',
      audio: 'none',
      meaning: 'visible',
      phonetic: 'hidden',
      letters: { mode: 'all-hidden' },
      probeDimension: 'none',
    },
    decision: {
      policyVersion: 'learn-acquisition-cold-probe-v2',
    },
  })

  await startTyping(page)
  await waitForRenderedWord(page, firstWord)
  const rendered = page.locator(
    `[data-typing-word="${firstWord}"]`,
  )
  await expect(rendered).toHaveAttribute(
    'data-review-purpose',
    'probe',
  )
  await expect(rendered).toHaveAttribute(
    'data-review-letters',
    'all-hidden',
  )
  await expect(rendered).toHaveAttribute(
    'data-review-hint-level',
    'cold',
  )

  await page.keyboard.type(firstWord)

  await expect
    .poll(async () => {
      return page.evaluate(async (word) => {
        return new Promise<{
          state?: {
            lifecycle?: string
            reviewCount?: number
            lapseCount?: number
            lastOutcome?: string
            nextReviewAt?: number
          }
          record?: {
            sourceMode?: string
            learnItemKind?: string
          }
          now: number
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
              const state = states.result.find(
                (item) => item.dict === 'cet4' && item.word === word,
              )
              const record = [...records.result]
                .reverse()
                .find(
                  (item) => item.dict === 'cet4' && item.word === word,
                )
              resolve({
                state: state
                  ? {
                      lifecycle: state.lifecycle,
                      reviewCount: state.reviewCount,
                      lapseCount: state.lapseCount,
                      lastOutcome: state.lastOutcome,
                      nextReviewAt: state.nextReviewAt,
                    }
                  : undefined,
                record: record
                  ? {
                      sourceMode: record.sourceMode,
                      learnItemKind: record.learnItemKind,
                    }
                  : undefined,
                now: Math.floor(Date.now() / 1000),
              })
              db.close()
            }
          }
        })
      }, firstWord)
    })
    .toMatchObject({
      state: {
        lifecycle: 'active',
        reviewCount: 0,
        lapseCount: 0,
      },
      record: {
        sourceMode: 'learn',
        learnItemKind: 'acquisition',
      },
    })

  const persisted = await page.evaluate(async (word) => {
    return new Promise<{
      nextReviewAt?: number
      lastOutcome?: string
      now: number
    }>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewWordStates', 'readonly')
        const all = tx.objectStore('reviewWordStates').getAll()
        all.onerror = () => reject(all.error)
        all.onsuccess = () => {
          const state = all.result.find(
            (item) => item.dict === 'cet4' && item.word === word,
          )
          resolve({
            nextReviewAt: state?.nextReviewAt,
            lastOutcome: state?.lastOutcome,
            now: Math.floor(Date.now() / 1000),
          })
          db.close()
        }
      }
    })
  }, firstWord)

  expect(persisted.lastOutcome).toBeUndefined()
  expect(persisted.nextReviewAt).toBeGreaterThan(
    persisted.now + 86_300,
  )
  expect(persisted.nextReviewAt).toBeLessThanOrEqual(
    persisted.now + 86_500,
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
  await page.getByRole('button', {
    name: '开始',
    exact: true,
  }).click()

  await expect(page).toHaveURL(/\/learn\/session$/)
  const info = await readReviewModeInfo(page)

  expect(info?.reviewRecord?.sessionKind).toBe('review')
  expect(
    info?.reviewRecord?.words?.map((word: { name: string }) => word.name),
  ).toEqual(['cancel'])
  expect(
    info?.reviewRecord?.exercisePlans?.cancel?.condition,
  ).toMatchObject({
    purpose: 'probe',
    letters: { mode: 'all-hidden' },
    audio: 'none',
  })
})


test('Hint ladder auto-advances after two failures at each active level', async ({
  page,
}) => {
  await seedReviewSession(page, reviewWords.slice(0, 1), 900030)
  await page.goto('/learn/session')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  const word = page.locator('[data-typing-word="cancel"]')
  await expect(word).toHaveAttribute('data-review-hint-level', 'cold')
  await expect(word).toHaveText('______')

  // Cold probe keeps the stricter rule: the same first-wrong position twice.
  await page.keyboard.type('cax')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await expect(word).toHaveAttribute('data-review-hint-level', 'cold')

  await page.keyboard.type('cax')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await expect(word).toHaveAttribute('data-review-hint-level', '0')
  await expect(word).toHaveAttribute('data-review-hint-position', '2')
  await expect(word).toHaveAttribute('data-review-forced-reveal', '2')
  await expect(word).toHaveText('__n___')

  await page.keyboard.type('x')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await expect(word).toHaveAttribute('data-review-hint-level', '0')
  await expect(word).toHaveAttribute('data-review-hint-stage-errors', '1')

  await page.keyboard.type('x')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await expect(word).toHaveAttribute('data-review-hint-level', '1')
  await expect(word).toHaveAttribute('data-review-forced-reveal', '0,2')
  await expect(word).toHaveAttribute('data-review-audio', 'automatic')
  await expect(word).toHaveAttribute('data-review-phonetic', 'visible')
  await expect(word).toHaveText('c_n___')

  await page.keyboard.type('cx')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await page.keyboard.type('cx')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await expect(word).toHaveAttribute('data-review-hint-level', '2')
  await expect(word).toHaveAttribute('data-review-forced-reveal', '0,1,2')
  await expect(word).toHaveText('can_e_')

  await page.keyboard.type('canx')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await page.keyboard.type('canx')
  await expect
    .poll(async () => await word.getAttribute('data-typing-input'))
    .toBe('')
  await expect(word).toHaveAttribute('data-review-hint-level', '3')
  await expect(word).toHaveAttribute('data-review-hint-stage', 'hint-3')
  await expect(word).toHaveText('cancel')

  const emphasized = word.locator('[data-review-hint-emphasis="true"]')
  await expect(emphasized).toHaveCount(0)

  await page.keyboard.type('cancel')
  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        return new Promise<{
          maxLevel?: number
          coldProbeSurrendered?: boolean
          advanceCount?: number
          hintPosition?: number
          autoHint0Triggered?: boolean
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
                    item.dict === 'cet4' &&
                    item.word === 'cancel' &&
                    item.chapter === -1,
                )
              resolve(record?.learningContext?.reviewHint ?? null)
              db.close()
            }
          }
        })
      })
    })
    .toMatchObject({
      maxLevel: 3,
      coldProbeSurrendered: false,
      advanceCount: 4,
      hintPosition: 2,
      autoHint0Triggered: true,
    })
})
