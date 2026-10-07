import { expect, test } from '@playwright/test'
import {
  readReviewModeInfo,
  seedAcquisitionSession,
  startTyping,
} from './review-flow-harness'

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
