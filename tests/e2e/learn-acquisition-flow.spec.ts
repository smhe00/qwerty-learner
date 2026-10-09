import { expect, test } from '@playwright/test'
import {
  readReviewModeInfo,
  reviewWords,
  seedAcquisitionSession,
  startTyping,
  waitForActiveLearnSession,
  waitForRenderedWord,
  gotoReviewAppReady,
} from './review-flow-harness'

test('Learn exposes only one unfinished session and cannot create a duplicate from the plan page', async ({
  page,
}) => {
  await gotoReviewAppReady(page)
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
  await gotoReviewAppReady(page)
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
  await gotoReviewAppReady(page, '/typing')

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

test('Learn weak review pressure does not silently override the configured daily target', async ({
  page,
}) => {
  await gotoReviewAppReady(page)
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
  await gotoReviewAppReady(page)
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



const incidentWord = { name: 'accurate', trans: ['准确的'], usphone: '', ukphone: '' }

async function readIncidentState(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const tx = database.transaction(['wordRecords', 'reviewWordStates'], 'readonly')
    const read = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const [records, state] = await Promise.all([
      read(tx.objectStore('wordRecords').getAll()),
      read(tx.objectStore('reviewWordStates').index('[dict+word]').get(['cet4', 'accurate'])),
    ])
    database.close()
    return {
      state,
      records: records.filter((record) => record.word === 'accurate'),
      daily: JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4') || 'null'),
    }
  })
}

test('incident ESC copy cannot create a stranded complete acquisition', async ({ page }) => {
  await seedAcquisitionSession(page, [incidentWord], 933001, 'independent', 4)
  await page.goto('/learn')
  await startTyping(page)
  const word = page.locator('[data-typing-word="accurate"]')
  await expect(word).toHaveAttribute('data-review-purpose', 'probe')
  await page.keyboard.press('Escape')
  await expect(word).toHaveAttribute('data-review-hint-level', '3')
  await page.keyboard.type('accurate')
  await expect.poll(async () => (await readReviewModeInfo(page))?.reviewRecord?.acquisitionStates?.accurate.phase)
    .toBe('supported')
  const snapshot = await readIncidentState(page)
  expect(snapshot.state).toBeUndefined()
  expect(snapshot.records).toHaveLength(1)
  expect(snapshot.records[0].wrongCount).toBe(0)
  expect(snapshot.records[0].reviewEvidence.memoryGrade).toBe('again')
  expect(snapshot.records[0].learningContext.reviewHint.coldProbeSurrendered).toBe(true)
  await expect(page.locator('[data-learn-acquisition-phase="supported"]')).toBeVisible()
  await expect(word).toHaveAttribute('data-typing-finished', 'false')
  await page.keyboard.type('accurate')
  await expect.poll(async () => (await readReviewModeInfo(page))?.reviewRecord?.acquisitionStates?.accurate.deferredReason)
    .toBe('spacing')
  expect((await readIncidentState(page)).state).toBeUndefined()
})

test('incident historical false completion recovers and finishes the frozen daily target', async ({ page }) => {
  await page.route('**/dicts/CET4_T.json', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([incidentWord]),
  }))
  await gotoReviewAppReady(page, '/typing')
  await expect(page.locator('[data-typing-word]').first()).toBeVisible()
  await page.evaluate(async (word) => {
    const now = Math.floor(Date.now() / 1000)
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(-1))
    localStorage.setItem('reviewModeInfo', JSON.stringify({ isReviewMode: false }))
    const date = new Date(now * 1000)
    const dateKey = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
    localStorage.setItem('qwerty.learn.dailySession.v1.cet4', JSON.stringify({
      version: 1, sessionId: 'incident-recovery', dict: 'cet4', dateKey, startedAt: now - 1000,
      status: 'active', dailyNewTarget: 1, plannedNewWords: 1, plannedReviewWords: [], carryOverAcquisitionWords: [],
      accumulatedActiveSeconds: 0, completedBlockIds: [], blockCount: 0,
    }))
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['reviewRecords', 'wordRecords', 'reviewWordStates'], 'readwrite')
        for (const name of ['reviewRecords', 'wordRecords', 'reviewWordStates']) tx.objectStore(name).clear()
        tx.objectStore('reviewRecords').add({
          id: 933002, dict: 'cet4', index: 0, createTime: now - 800, words: [word], isFinished: true, sessionKind: 'acquisition',
          acquisitionStates: { accurate: { version: 1, phase: 'complete', assistedCycles: 0, independentInterveningItems: 4 } },
        })
        const raw = { word: 'accurate', dict: 'cet4', chapter: -1, timing: [], wrongCount: 0, mistakes: {}, sourceMode: 'learn', learnItemKind: 'acquisition' }
        tx.objectStore('wordRecords').add({ ...raw, timeStamp: now - 800, reviewPolicyDecision: {
          version: 1, policyVersion: 'learn-acquisition-exposure-v1', reasonCodes: [], conditionVersion: 1,
        } })
        tx.objectStore('wordRecords').add({ ...raw, timeStamp: now - 700,
          reviewPolicyDecision: { version: 1, policyVersion: 'canonical-review-hint-v2', reasonCodes: [], conditionVersion: 1 },
          learningContext: { version: 1, answerRevealed: true, reviewHint: { version: 1, maxLevel: 3, coldProbeSurrendered: true, advanceCount: 1 } },
          reviewEvidence: { version: 1, memoryGrade: 'again', errorCause: 'recall', confidence: 1, evidenceStrength: 1, retrievalValidity: 'independent', reasonCodes: ['cold-probe-surrendered'] },
        })
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
        tx.oncomplete = () => { db.close(); resolve() }
      }
    })
  }, incidentWord)
  await page.goto('/learn')
  const recovered = await waitForActiveLearnSession(page)
  expect(recovered.reviewRecord.words.map((item: { name: string }) => item.name)).toEqual(['accurate'])
  expect(recovered.reviewRecord.acquisitionStates.accurate.phase).toBe('supported')
  await startTyping(page)
  await page.keyboard.type('accurate')
  await expect.poll(async () => (await readReviewModeInfo(page))?.reviewRecord?.isFinished).toBe(true)
  const pending = (await readReviewModeInfo(page)).reviewRecord.acquisitionStates.accurate
  expect(pending.deferredReason).toBe('spacing')
  expect((await readIncidentState(page)).state).toBeUndefined()
  await expect(page.getByRole('button', { name: '按任意键继续', exact: true })).toBeEnabled()
  await page.evaluate(() => { const realNow = Date.now; Date.now = () => realNow() + 301_000 })
  await page.getByRole('button', { name: '按任意键继续', exact: true }).click()
  const resumed = await waitForActiveLearnSession(page)
  expect(resumed.reviewRecord.acquisitionStates.accurate.phase).toBe('independent')
  await startTyping(page)
  await expect(page.locator('[data-typing-word="accurate"]')).toHaveAttribute('data-review-purpose', 'probe')
  await page.keyboard.type('accurate')
  await expect.poll(async () => (await readIncidentState(page)).daily?.status).toBe('completed')
  const completed = await readIncidentState(page)
  expect(completed.state?.lifecycle).toBe('active')
  expect(completed.records).toHaveLength(4)
  expect(completed.records[3].reviewPolicyDecision.policyVersion).toBe('learn-acquisition-independent-v1')
  expect(completed.records[3].reviewPolicyDecision.reasonCodes).toContain('spacing-eligible')
  await expect(page.locator('[data-learn-result-screen]')).toHaveAttribute('data-learn-daily-complete', 'true')
})
