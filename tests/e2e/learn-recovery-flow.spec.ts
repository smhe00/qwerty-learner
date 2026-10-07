import { expect, test } from '@playwright/test'
import {
  readReviewModeInfo,
  readReviewWordRecords,
  reviewWords,
  seedReviewSession,
  startTyping,
  waitForRenderedWord,
} from './review-flow-harness'

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

