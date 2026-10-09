import { expect, test, type Page } from '@playwright/test'
import {
  readReviewModeInfo,
  readReviewWordRecords,
  reviewWords,
  seedReviewSession,
  startTyping,
  waitForRenderedWord,
  waitForReviewIndex,
} from './review-flow-harness'

/**
 * Tests the ACTUAL Learn UI and native RecordDB, not synthetic
 * wordRecords writes. Fixtures only create a deterministic starting session.
 *
 * Trace contains only controlled fixture session IDs, cursor positions and
 * counts; never export localStorage, tokens or user word history.
 */
type Durable = {
  cursor: number | null
  finished: boolean | null
  recordRows: number
  uniqueWords: number
}
type Checkpoint = {
  label: string
  pathname: string
  uiCursor: number | null
  durable: Durable
}

async function durable(page: Page, sessionId: number): Promise<Durable> {
  return page.evaluate(async (id) => {
    return new Promise<Durable>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['reviewRecords', 'wordRecords'], 'readonly')
        const sessions = tx.objectStore('reviewRecords').getAll()
        const words = tx.objectStore('wordRecords').getAll()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
        tx.oncomplete = () => {
          const row = sessions.result.find(
            (item: { id?: number; createTime?: number }) =>
              (item.id ?? item.createTime) === id,
          )
          const records = words.result.filter(
            (item: { dict: string; chapter: number; sourceMode?: string }) =>
              item.dict === 'cet4' &&
              item.chapter === -1 &&
              item.sourceMode === 'learn',
          )
          resolve({
            cursor: row?.index ?? null,
            finished: row?.isFinished ?? null,
            recordRows: records.length,
            uniqueWords: new Set(records.map((item: { word: string }) => item.word)).size,
          })
          db.close()
        }
      }
    })
  }, sessionId)
}

test('real Learn keyboard journey commits each word exactly once across reload', async ({
  page,
}) => {
  const sessionId = 927101
  const checkpoints: Checkpoint[] = []
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))

  async function capture(label: string) {
    const info = await readReviewModeInfo(page)
    checkpoints.push({
      label,
      pathname: new URL(page.url()).pathname,
      uiCursor: info?.reviewRecord?.index ?? null,
      durable: await durable(page, sessionId),
    })
  }

  try {
    await seedReviewSession(page, reviewWords, sessionId)
    await page.goto('/learn')
    await startTyping(page)
    await waitForRenderedWord(page, 'cancel')
    await capture('started')

    // Real keyboard input, not direct injection into wordRecords.
    await page.keyboard.type('cancel')
    await waitForReviewIndex(page, 1)
    await expect.poll(async () => (await durable(page, sessionId)).cursor).toBe(1)
    await expect.poll(async () => (await durable(page, sessionId)).recordRows).toBe(1)
    await capture('first-word-committed')

    // Close the document mid-block. A committed word must survive reload,
    // and re-entry must resume the NEXT word, without replaying evidence.
    await page.reload()
    await expect(page).toHaveURL(/\/learn$/)
    await waitForRenderedWord(page, 'analyse')
    await expect.poll(async () => (await readReviewModeInfo(page))?.reviewRecord?.index).toBe(1)
    await capture('reloaded-at-second-word')
    expect(checkpoints.at(-1)?.durable).toMatchObject({
      cursor: 1,
      recordRows: 1,
      uniqueWords: 1,
    })

    await startTyping(page)
    await waitForRenderedWord(page, 'analyse')
    await page.keyboard.type('analyse')
    await waitForReviewIndex(page, 2)
    await expect.poll(async () => (await durable(page, sessionId)).recordRows).toBe(2)
    await capture('second-word-committed')

    await waitForRenderedWord(page, 'numerous')
    await page.keyboard.type('numerous')
    await expect.poll(async () =>
      (await readReviewModeInfo(page))?.reviewRecord?.isFinished,
    ).toBe(true)
    await expect.poll(async () => (await durable(page, sessionId)).finished).toBe(true)
    await expect.poll(async () => (await durable(page, sessionId)).recordRows).toBe(3)
    await capture('block-complete')

    const records = await readReviewWordRecords(page, reviewWords.map((item) => item.name))
    expect(records.map((item) => item.word)).toEqual([
      'cancel', 'analyse', 'numerous',
    ])
    expect(records.every((item) => item.wrongCount === 0)).toBe(true)

    await page.reload()
    await expect(page).toHaveURL(/\/learn$/)
    // Completed blocks may reopen on the pause/result screen rather than
    // the idle Start UI. Assert boot readiness and durable data, not one UI skin.
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
    await capture('reloaded-after-block')
    expect(checkpoints.at(-1)?.durable).toEqual({
      cursor: 3,
      finished: true,
      recordRows: 3,
      uniqueWords: 3,
    })
    expect(runtimeErrors).toEqual([])
  } finally {
    await test.info().attach('learn-checkpoints-redacted.json', {
      body: Buffer.from(JSON.stringify({
        schema: 'learn-ui-durable-trace-v1',
        scenario: 'three-fixture-words-reload-after-first-commit',
        checkpoints,
        pageErrorCount: runtimeErrors.length,
      }, null, 2)),
      contentType: 'application/json',
    })
  }
})
