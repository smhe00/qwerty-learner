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

async function seedReviewAdmissionCase(
  page: import('@playwright/test').Page,
  options: { freshLearningAfterReview: boolean },
) {
  await page.goto('/')

  await page.evaluate(async ({ freshLearningAfterReview }) => {
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
  await page.getByText('错题回顾', { exact: true }).click()
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


test('fresh ordinary-learning failure reopens a previously reviewed word immediately', async ({
  page,
}) => {
  await seedReviewAdmissionCase(page, {
    freshLearningAfterReview: true,
  })

  await page.getByRole('button', { name: '开始复习' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return {
        enabled: info?.isReviewMode,
        words: info?.reviewRecord?.words?.map(
          (word: { name: string }) => word.name,
        ),
      }
    })
    .toEqual({
      enabled: true,
      words: ['cancel'],
    })
})

test('no-due screen offers Force Review and force bypasses only the time gate', async ({
  page,
}) => {
  await seedReviewAdmissionCase(page, {
    freshLearningAfterReview: false,
  })

  await page.getByRole('button', { name: '开始复习' }).click()

  await expect(
    page.getByText(
      '当前没有到期需要复习的错词。你可以等待调度时间，或强制复习当前错词。',
    ),
  ).toBeVisible()

  await page.getByRole('button', { name: '强制开始复习' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return info?.reviewRecord?.words?.map(
        (word: { name: string }) => word.name,
      )
    })
    .toEqual(['cancel'])
})
