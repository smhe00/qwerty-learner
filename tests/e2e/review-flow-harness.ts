import { expect } from '@playwright/test'


/**
 * Legacy review-flow fixtures seed the real RecordDB directly, without
 * mocking product queries. Since S1 moved app import behind a guarded boot
 * and raised RecordDB to Dexie V6, "page.goto" no longer guarantees the app
 * has opened/upgraded the database. Native indexedDB.open() can otherwise
 * block behind the app's pending versionchange and hang page.evaluate().
 *
 * Wait for the real app to mount, then open the same production Dexie V6
 * module through a browser module script (not a serialized evaluate import).
 * Do not initialize a fake database or lower any Learn assertion.
 */
export async function gotoReviewAppReady(
  page: import('@playwright/test').Page,
  route: '/' | '/typing' = '/',
): Promise<void> {
  await page.goto(route)
  await expect(
    page.getByRole('button', { name: '打开设置对话框' }),
  ).toBeVisible({ timeout: 15_000 })
  await page.addScriptTag({
    type: 'module',
    content: [
      "import { db } from '/src/utils/db/core.ts'",
      'try {',
      '  await db.open()',
      '  window.__qwertyReviewDbReady = { ok: true }',
      '} catch (error) {',
      '  window.__qwertyReviewDbReady = { ok: false, message: String(error) }',
      '}',
    ].join('\\n'),
  })
  const ready = await expect.poll(
    () => page.evaluate(() =>
      (window as Window & {
        __qwertyReviewDbReady?: { ok: boolean; message?: string }
      }).__qwertyReviewDbReady,
    ),
    { timeout: 15_000 },
  ).not.toBeUndefined()
  void ready
  const result = await page.evaluate(() =>
    (window as Window & {
      __qwertyReviewDbReady?: { ok: boolean; message?: string }
    }).__qwertyReviewDbReady,
  )
  if (!result?.ok) {
    throw new Error('Review fixture RecordDB V6 initialization failed: ' +
      (result?.message ?? 'no readiness result'))
  }
}

export type ReviewWord = {
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

export const reviewWords: ReviewWord[] = [
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

export async function seedReviewSession(
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

export async function seedAcquisitionSession(
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

export async function readReviewModeInfo(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('reviewModeInfo')
    return raw ? JSON.parse(raw) : undefined
  })
}

export async function waitForActiveLearnSession(
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

export async function waitForReviewIndex(
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

export async function waitForRenderedWord(
  page: import('@playwright/test').Page,
  word: string,
) {
  await expect(page.locator(`[data-typing-word="${word}"]`)).toBeVisible()
}


export async function readRenderedAttemptState(
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

export async function startTyping(page: import('@playwright/test').Page) {
  await expect(page.getByText('按任意键开始')).toBeVisible()
  // The first legal key starts Typing and is intentionally not part of the word.
  await page.keyboard.press('a')
}

export async function readReviewWordRecords(
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

export async function putDueReviewWordState(
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

export async function readReviewGateState(
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

export async function seedReviewAdmissionCase(
  page: import('@playwright/test').Page,
  options: { freshLearningAfterReview: boolean },
) {
  await gotoReviewAppReady(page)

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
