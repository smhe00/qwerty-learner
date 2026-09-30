import { expect, test } from '@playwright/test'

const reviewWords = [
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

test('multi-word Review advances deterministically and ignores post-completion extra keys', async ({
  page,
}) => {
  await page.addInitScript((words) => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(-1))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({
        isReviewMode: true,
        reviewRecord: {
          id: 900001,
          dict: 'cet4',
          createTime: 1,
          index: 0,
          isFinished: false,
          words,
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
  }, reviewWords)

  await page.goto('/')
  await expect(page.getByText('按任意键开始')).toBeVisible()

  // The first legal key starts Typing and is intentionally not part of the word.
  await page.keyboard.press('a')

  // Extra "x" is sent in the same burst after the final correct key. It must
  // not become wrongIndex === word.length evidence on the completed word.
  await page.keyboard.type('cancelx')
  await waitForReviewIndex(page, 1)

  await page.keyboard.type('analyse')
  await waitForReviewIndex(page, 2)

  await page.keyboard.type('numerous')

  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return info?.reviewRecord?.isFinished
    })
    .toBe(true)

  const persisted = await page.evaluate(async () => {
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
                ['cancel', 'analyse', 'numerous'].includes(record.word),
            ),
          )
          db.close()
        }
      }
    })
  })

  expect(persisted.map((record) => record.word)).toEqual([
    'cancel',
    'analyse',
    'numerous',
  ])
  const cancel = persisted.find((record) => record.word === 'cancel')
  expect(cancel?.wrongCount).toBe(0)
  expect(cancel?.mistakes?.['6']).toBeUndefined()
  expect(
    cancel?.typingTelemetry?.attempts?.some(
      (attempt) => attempt.wrongIndex === 6,
    ),
  ).toBe(false)
})
