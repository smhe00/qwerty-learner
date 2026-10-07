// RC 2026-09-30 review-formal-gate-v1 production acceptance marker
import { readFile } from 'node:fs/promises'
import {
  parseDiagnosticExport,
  replayDiagnostic,
} from '../../src/dev/replay'
import { expect, test } from '@playwright/test'

type ReviewWord = {
  name: string
  trans: string[]
  usphone: string
  ukphone: string
  example?: Array<{
    en: string
    cn: string
    start: number
    end: number
  }>
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
      const seedKey = `qwerty:e2e:review-session-seed:${recordId}`
      if (sessionStorage.getItem(seedKey) === 'done') return
      sessionStorage.setItem(seedKey, 'done')

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
      const now = Math.floor(Date.now() / 1000)
      const date = new Date(now * 1000)
      const dateKey = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-')
      localStorage.setItem(
        'qwerty.learn.dailySession.v1.cet4',
        JSON.stringify({
          version: 1,
          sessionId: `e2e-review:${recordId}:${dateKey}`,
          dict: 'cet4',
          dateKey,
          startedAt: now,
          status: 'active',
          dailyNewTarget: 32,
          plannedNewWords: 32,
          plannedReviewWords: seededWords.map((word) => word.name),
          carryOverAcquisitionWords: [],
          accumulatedActiveSeconds: 0,
          completedBlockIds: [],
          blockCount: 0,
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

async function seedAcquisitionSession(
  page: import('@playwright/test').Page,
  words: ReviewWord[],
  id: number,
  phase: 'exposure' | 'supported' | 'independent' = 'independent',
  independentInterveningItems = 4,
  scaffoldStrainTier:
    | 'unknown'
    | 'low'
    | 'elevated'
    | 'recovery' = 'unknown',
  phaseOverrides: Record<
    string,
    'exposure' | 'supported' | 'independent'
  > = {},
) {
  await page.addInitScript(
    ({
      seededWords,
      recordId,
      seededPhase,
      seededIndependentInterveningItems,
      seededScaffoldStrainTier,
      seededPhaseOverrides,
    }) => {
      const phaseData = (
        wordPhase: 'exposure' | 'supported' | 'independent',
      ) => {
        const condition =
          wordPhase === 'exposure'
            ? {
                purpose: 'training',
                audio: 'automatic',
                phonetic: 'visible',
                letters: { mode: 'all-visible' },
              }
            : {
                purpose:
                  wordPhase === 'independent' ? 'probe' : 'training',
                audio: 'none',
                phonetic: 'hidden',
                letters: { mode: 'all-hidden' },
              }
        const policyVersion =
          wordPhase === 'exposure'
            ? 'learn-acquisition-exposure-v1'
            : wordPhase === 'independent'
              ? 'learn-acquisition-independent-v1'
              : 'learn-acquisition-supported-v1'
        return { condition, policyVersion }
      }

      localStorage.setItem('currentDict', JSON.stringify('cet4'))
      localStorage.setItem('currentChapter', JSON.stringify(-1))
      localStorage.setItem(
        'reviewModeInfo',
        JSON.stringify({
          isReviewMode: true,
          reviewRecord: {
            id: recordId,
            dict: 'cet4',
            createTime: recordId,
            index: 0,
            isFinished: false,
            sessionKind: 'acquisition',
            words: seededWords,
            exercisePlans: Object.fromEntries(
              seededWords.map((word) => {
                const wordPhase =
                  seededPhaseOverrides[word.name] ?? seededPhase
                const { condition, policyVersion } =
                  phaseData(wordPhase)
                return [
                  word.name,
                  {
                    version: 1,
                    condition: {
                      version: 1,
                      source: 'adaptive-policy',
                      meaning: 'visible',
                      probeDimension: 'none',
                      ...condition,
                    },
                    decision: {
                      version: 1,
                      policyVersion,
                      reasonCodes:
                        wordPhase === 'independent'
                          ? [
                              'e2e-acquisition-phase',
                              `intervening-items-${seededIndependentInterveningItems}`,
                              ...(seededIndependentInterveningItems >= 2
                                ? ['spacing-eligible']
                                : ['spacing-insufficient']),
                            ]
                          : ['e2e-acquisition-phase'],
                      conditionVersion: 1,
                    },
                    sourceShadowVersion: 1,
                  },
                ]
              }),
            ),
            acquisitionStates: Object.fromEntries(
              seededWords.map((word) => {
                const wordPhase =
                  seededPhaseOverrides[word.name] ?? seededPhase
                return [
                  word.name,
                  {
                    version: 1,
                    phase: wordPhase,
                    assistedCycles: 0,
                    scaffoldStrainTier: seededScaffoldStrainTier,
                    ...(wordPhase === 'independent'
                      ? {
                          independentInterveningItems:
                            seededIndependentInterveningItems,
                        }
                      : {}),
                  },
                ]
              }),
            ),
          },
        }),
      )
      const now = Math.floor(Date.now() / 1000)
      const date = new Date(now * 1000)
      const dateKey = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-')
      localStorage.setItem(
        'qwerty.learn.dailySession.v1.cet4',
        JSON.stringify({
          version: 1,
          sessionId: `e2e-acquisition:${recordId}:${dateKey}`,
          dict: 'cet4',
          dateKey,
          startedAt: now,
          status: 'active',
          dailyNewTarget: 32,
          plannedNewWords: 32,
          plannedReviewWords: [],
          carryOverAcquisitionWords: [],
          accumulatedActiveSeconds: 0,
          completedBlockIds: [],
          blockCount: 0,
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
    {
      seededWords: words,
      recordId: id,
      seededPhase: phase,
      seededIndependentInterveningItems:
        independentInterveningItems,
      seededScaffoldStrainTier: scaffoldStrainTier,
      seededPhaseOverrides: phaseOverrides,
    },
  )
}

async function readReviewModeInfo(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('reviewModeInfo')
    return raw ? JSON.parse(raw) : undefined
  })
}

async function waitForActiveLearnSession(
  page: import('@playwright/test').Page,
) {
  await expect
    .poll(
      async () => {
        const info = await readReviewModeInfo(page)
        return Boolean(
          info?.isReviewMode &&
            info?.reviewRecord &&
            info.reviewRecord.isFinished !== true,
        )
      },
      { timeout: 15_000 },
    )
    .toBe(true)

  await expect(
    page.locator('[data-typing-word]').first(),
  ).toBeVisible({ timeout: 15_000 })

  return readReviewModeInfo(page)
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
    const previousReviewAt = now - 86_400
    const state = {
      dict: 'cet4',
      word: targetWord,
      createdAt: now - 172_800,
      updatedAt: previousReviewAt,
      lastReviewedAt: previousReviewAt,
      nextReviewAt: now - 1,
      reviewCount: 1,
      lapseCount: 0,
      cleanStreak: 1,
      lastOutcome: 'good',
      lifecycle: 'active',
      stateVersion: 5,
      schedulerState: {
        kind: 'fsrs6',
        difficulty: 5,
        stability: 1,
        parameterSetId: 'fsrs6-default-r0.84-no-fuzz-long-term-v1',
      },
    }

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(
          ['wordRecords', 'reviewWordStates'],
          'readwrite',
        )
        tx.objectStore('wordRecords').add({
          word: targetWord,
          timeStamp: previousReviewAt,
          dict: 'cet4',
          chapter: -1,
          timing: [],
          wrongCount: 0,
          mistakes: {},
          sourceMode: 'learn',
          learnItemKind: 'review',
          reviewRatingDecision: {
            eligible: true,
            rating: 'good',
            confidence: 1,
            reasonCodes: ['e2e-native-fsrs-seed'],
          },
        })
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
      shadow?: {
        libraryVersion?: string
        algorithmModel?: string
        parameterSetId?: string
        rating?: string
        retrievabilityBefore?: number | null
        selectedIntervalDays?: number
        historyCoverage?: string
        replayedEligibleEvents?: number
        basicV2?: {
          dueAt?: number
          nominalIntervalDays?: number
        }
        counterfactual?: Record<string, { intervalDays?: number }>
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
            shadow: record?.fsrsShadow,
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
          sourceMode: 'learn',
          learnItemKind: 'review',
          reviewRatingDecision: {
            eligible: true,
            rating: 'good',
            confidence: 1,
            reasonCodes: ['e2e-native-fsrs-seed'],
          },
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
          lifecycle: 'active',
          stateVersion: 5,
          schedulerState: {
            kind: 'fsrs6',
            difficulty: 5,
            stability: 1,
            parameterSetId:
              'fsrs6-default-r0.84-no-fuzz-long-term-v1',
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
  await expect(page.getByText('按任意键开始')).toBeVisible()
  await startTyping(page)
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('今日到期', { exact: true })).toHaveCount(0)
  await expect(page.getByText('学习计划', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Typing', exact: true }).click()
  await expect(page).toHaveURL(/\/typing$/)
  await expect(
    page.getByRole('button', { name: 'Typing', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('Learn entry keeps long-term state while plan details stay hidden', async ({
  page,
}) => {
  await seedReviewAdmissionCase(page, {
    freshLearningAfterReview: false,
  })

  await page.goto('/learn')
  await expect(page).toHaveURL(/\/learn$/)
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
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('移出学习计划')
    await dialog.accept()
  })

  await page.getByRole('button', { name: 'Learn 单词菜单' }).click()
  await page.getByRole('button', { name: '移出学习计划' }).click()

  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return {
        words: info?.reviewRecord?.words?.map(
          (word: { name: string }) => word.name,
        ),
        index: info?.reviewRecord?.index,
        isFinished: info?.reviewRecord?.isFinished,
      }
    })
    .toEqual({
      words: ['analyse'],
      index: 0,
      isFinished: false,
    })
  await expect(page.getByText('CET-4 Learn', { exact: true })).toHaveCount(0)
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
  await waitForActiveLearnSession(page)
  await page.getByRole('link', { name: 'CET-4', exact: true }).click()
  await expect(page).toHaveURL(/\/gallery\?mode=learn$/)

  const target = page
    .getByRole('button', {
      name: /^选择 Learn 词库：/,
    })
    .first()
  await expect(target).toBeVisible()

  const targetLabel = await target.getAttribute('aria-label')
  expect(targetLabel).toMatch(/^选择 Learn 词库：.+/)
  const selectedDictionaryName = targetLabel?.replace(
    /^选择 Learn 词库：/,
    '',
  )
  expect(selectedDictionaryName).toBeTruthy()

  await target.click()

  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.getByRole('link', {
      name: selectedDictionaryName as string,
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByText('章节选择', { exact: true })).toHaveCount(0)
})

test('developer diagnostics exports a read-only incident bundle from the UI', async ({
  page,
}) => {
  await page.goto('/typing')
  await page.getByTitle('打开设置对话框').click()
  await page.getByRole('tab', { name: '开发诊断', exact: true }).click()

  const downloadPromise = page.waitForEvent('download')
  await page
    .getByRole('button', { name: '导出现场诊断包', exact: true })
    .click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(
    /^Qwerty-Plus-Incident-.*\.json$/,
  )
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const exported = await readFile(downloadPath as string, 'utf8')
  const parsed = parseDiagnosticExport(exported)
  expect(parsed.kind).toBe('incident')
  expect(parsed.schema).toBe('qwerty-developer-incident-v1')
  const replay = replayDiagnostic(parsed)
  expect(replay.eventCount).toBeGreaterThanOrEqual(0)

  await expect(
    page.getByText('现场诊断包已导出。请直接把该 JSON 文件发给开发者。'),
  ).toBeVisible()

  // Export is read-only: the current route and Learn/Typing ownership do not
  // change merely because diagnostics were captured.
  await expect(page).toHaveURL(/\/typing$/)
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
  await expect(page).toHaveURL(/\/learn$/)
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

  const analysisButton = page.getByRole('button', {
    name: '查看数据统计',
    exact: true,
  })
  await expect(analysisButton).toBeEnabled()
  await expect(
    page.getByRole('button', {
      name: '错题本（Learn 模式禁用）',
      exact: true,
    }),
  ).toBeDisabled()

  const sessionBeforeAnalysis = await readReviewModeInfo(page)
  await analysisButton.click()
  await expect(page).toHaveURL(/\/analysis\?from=learn$/)
  await expect(
    page.getByRole('heading', { name: 'Learn 数据统计', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('当前到期', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('30日复习通过率', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(page.getByText('按任意键开始')).toBeVisible()
  const sessionAfterAnalysis = await readReviewModeInfo(page)
  expect(
    sessionAfterAnalysis?.reviewRecord?.id ??
      sessionAfterAnalysis?.reviewRecord?.createTime,
  ).toBe(
    sessionBeforeAnalysis?.reviewRecord?.id ??
      sessionBeforeAnalysis?.reviewRecord?.createTime,
  )

  const pronunciationButton = page.getByRole('button', {
    name: '发音口音：英音',
    exact: true,
  })
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
  // Learn owns acquisition presentation. Typing preferences remain stored,
  // but first exposure deliberately shows the answer/phonetic and plays audio.
  await expect(rendered).toHaveAttribute('data-review-audio', 'automatic')
  await expect(rendered).toHaveAttribute(
    'data-review-letters',
    'all-visible',
  )
  await expect(rendered).toHaveAttribute(
    'data-review-phonetic',
    'visible',
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

test('light app theme keeps inherited Typing header controls readable when OS prefers dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => {
    localStorage.setItem('isOpenDarkModeAtom', JSON.stringify(false))
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
  })

  await page.goto('/typing')

  const html = page.locator('html')
  await expect(html).not.toHaveClass(/dark/)
  await expect(html).toHaveCSS('color-scheme', 'light')

  const header = page.locator('header nav')
  await expect(header).toHaveCSS('background-color', 'rgb(255, 255, 255)')

  const dictionary = header.locator('a[href="/gallery"]')
  const chapter = header.getByRole('button', {
    name: '第 1 章',
    exact: true,
  })
  const pronunciation = header.getByRole('button', {
    name: /发音及音标切换：/,
  })

  await expect(dictionary).toBeVisible()
  await expect(chapter).toBeVisible()
  await expect(pronunciation).toBeVisible()

  const colors = await Promise.all(
    [dictionary, chapter, pronunciation].map((control) =>
      control.evaluate((element) => getComputedStyle(element).color),
    ),
  )

  for (const color of colors) {
    expect(color).not.toBe('rgb(255, 255, 255)')
    expect(color).not.toBe('rgba(255, 255, 255, 1)')
    expect(color).not.toBe('rgba(0, 0, 0, 0)')
  }
})



test('Typing and Learn use the same indigo interaction palette', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('isOpenDarkModeAtom', JSON.stringify(false))
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
  })

  await page.goto('/typing')

  const typingMode = page.getByRole('button', {
    name: 'Typing',
    exact: true,
  })
  const typingStart = page.getByRole('button', {
    name: '开始',
    exact: true,
  })

  const typingModeColor = await typingMode.evaluate(
    (element) => getComputedStyle(element).color,
  )
  const typingStartBackground = await typingStart.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )
  const typingDictionary = page.locator('header nav a[href="/gallery"]')
  await typingDictionary.hover()
  const typingTransitionMs = await typingDictionary.evaluate((element) => {
    const value = getComputedStyle(element).transitionDuration.split(',')[0]
    return Number.parseFloat(value) * (value.includes('ms') ? 1 : 1000)
  })
  await page.waitForTimeout(typingTransitionMs + 50)
  const typingDictionaryHoverBackground = await typingDictionary.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )

  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)

  const learnMode = page.getByRole('button', {
    name: 'Learn',
    exact: true,
  })
  const learnStart = page.getByRole('button', {
    name: '开始',
    exact: true,
  })

  await expect(learnMode).toHaveCSS('color', typingModeColor)
  await expect(learnStart).toHaveCSS(
    'background-color',
    typingStartBackground,
  )

  const learnDictionary = page.locator('header nav a[href="/gallery?mode=learn"]')
  await learnDictionary.hover()
  const learnTransitionMs = await learnDictionary.evaluate((element) => {
    const value = getComputedStyle(element).transitionDuration.split(',')[0]
    return Number.parseFloat(value) * (value.includes('ms') ? 1 : 1000)
  })
  await page.waitForTimeout(learnTransitionMs + 50)
  await expect(learnDictionary).toHaveCSS(
    'background-color',
    typingDictionaryHoverBackground,
  )
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

test('oversized legacy acquisition session is closed and returned to Learn idle for rechunking', async ({
  page,
}) => {
  const legacyWords = Array.from({ length: 21 }, (_, index) => ({
    name: `legacy-acq-${index}`,
    trans: [`legacy ${index}`],
    usphone: '',
    ukphone: '',
  }))

  await seedAcquisitionSession(
    page,
    legacyWords,
    900092,
    'exposure',
  )
  await page.goto('/learn')

  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.getByRole('button', {
      name: '开始 Learn',
      exact: true,
    }),
  ).toBeVisible()

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
              .get(900092)
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


test('legacy all-visible Learn item without acquisition metadata never enters Hint', async ({
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
      'reviewModeInfo',
      JSON.stringify({
        isReviewMode: true,
        reviewRecord: {
          id: 900093,
          dict: 'cet4',
          createTime: 900093,
          index: 0,
          isFinished: false,
          words: [word],
          // Deliberately omit sessionKind/itemKinds/acquisitionStates.
          exercisePlans: {
            cancel: {
              version: 1,
              condition: {
                version: 1,
                purpose: 'training',
                source: 'adaptive-policy',
                audio: 'automatic',
                meaning: 'visible',
                phonetic: 'visible',
                letters: { mode: 'all-visible' },
                probeDimension: 'none',
              },
              decision: {
                version: 1,
                policyVersion: 'learn-acquisition-exposure-v1',
                reasonCodes: ['legacy-visible-copy'],
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

  await page.goto('/learn')
  await startTyping(page)
  const word = page.locator('[data-typing-word="cancel"]')
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
})

test('metadata-less legacy Learn queue over 20 unique words is rotated before resume', async ({
  page,
}) => {
  const words = Array.from({ length: 21 }, (_, index) => ({
    name: `legacy-real-${index}`,
    trans: [`legacy ${index}`],
    usphone: '',
    ukphone: '',
  }))

  await page.addInitScript((seededWords) => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(-1))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({
        isReviewMode: true,
        reviewRecord: {
          id: 900094,
          dict: 'cet4',
          createTime: 900094,
          index: 7,
          isFinished: false,
          words: seededWords,
          // This is the shape seen in older real checkpoints:
          // no sessionKind/itemKinds/acquisitionStates.
        },
      }),
    )
  }, words)

  await page.goto('/learn')

  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.getByRole('button', {
      name: '开始 Learn',
      exact: true,
    }),
  ).toBeVisible()

  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return info?.reviewRecord
    })
    .toBeUndefined()
})
