// Browser coverage for TASK-20261007-008.
//
// Learn and Typing share one spelling engine page. The live statistics strip
// must switch with the surface: Learn shows five cumulative, pressure-free
// metrics while Typing keeps 时间 / 输入数 / WPM / 正确数 / 正确率 untouched.
// Persisted Learn evidence also has to survive a reload without double
// counting, which is why the fixtures are seeded through the real Dexie schema.

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const SESSION_START = 1_700_000_000

type SeedPayload = {
  dict: string
  session: {
    id?: number
    createTime: number
    index?: number
    isFinished?: boolean
    words: string[]
    sessionKind?: 'review' | 'acquisition' | 'mixed'
    itemKinds?: Record<string, 'review' | 'acquisition'>
    itemStates?: Record<
      string,
      {
        phase: string
        ratingEmitted: boolean
        invalidRetryRemaining: number
        reinforcementRemaining: number
        diagnosticRemaining: number
      }
    >
    acquisitionStates?: Record<string, { version: number; phase: string; assistedCycles: number }>
  }
  wordRecords?: Array<{
    word: string
    timeStamp: number
    dict?: string
    sourceMode?: 'typing' | 'learn'
    learnItemKind?: 'review' | 'acquisition'
    retrievalValidity?: 'independent' | 'assisted' | 'uncertain' | 'unknown'
    errorCause?: 'clean' | 'recall' | 'spelling' | 'motor' | 'uncertain'
  }>
}

async function seedLearnSession(page: Page, payload: SeedPayload) {
  await page.goto('/tests/e2e/learn-live-stats-harness.html')
  await expect(page.getByText('learn live stats harness ready')).toBeVisible()
  await page.evaluate(async (input) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__learnLiveStatsHarness.seed(input)
  }, payload)
}

async function readLearnStrip(page: Page): Promise<string[]> {
  const strip = page.locator('[data-learn-live-stats]')
  await strip.waitFor()
  const cells = await strip.locator('div').allTextContents()
  return cells.map((cell) => cell.trim())
}

function reviewItemState(phase: string) {
  return {
    phase,
    ratingEmitted: true,
    invalidRetryRemaining: 0,
    reinforcementRemaining: 0,
    diagnosticRemaining: 0,
  }
}

test('Learn shows exactly five pressure-free live metrics', async ({ page }) => {
  await seedLearnSession(page, {
    dict: 'cet4',
    session: {
      createTime: SESSION_START,
      words: ['cancel', 'analyse'],
      sessionKind: 'review',
    },
  })

  await page.goto('/learn')
  const cells = await readLearnStrip(page)

  expect(cells).toHaveLength(5)
  expect(cells[0]).toMatch(/^\d{2}:\d{2}学习时间$/)
  expect(cells[1]).toBe('0/2本轮进度')
  expect(cells[2]).toBe('0新学')
  expect(cells[3]).toBe('0已复习')
  expect(cells[4]).toBe('0独立回忆')

  const stripText = await page.locator('[data-learn-live-stats]').textContent()
  for (const banned of [
    'WPM',
    '正确率',
    '正确数',
    '错误',
    '输入数',
    'Hint',
    'Again',
  ]) {
    expect(stripText ?? '').not.toContain(banned)
  }
})

test('Typing control keeps the original five statistics', async ({ page }) => {
  await page.goto('/typing')
  const strip = page.locator('.my-card').last()
  await strip.waitFor()

  const cells = (await strip.locator('div').allTextContents()).map((cell) =>
    cell.trim(),
  )

  expect(cells).toEqual([
    '00:00时间',
    '0输入数',
    '0WPM',
    '0正确数',
    '0正确率',
  ])
  await expect(page.locator('[data-learn-live-stats]')).toHaveCount(0)
})

test('Learn reconstructs persisted evidence and survives reload without double counting', async ({
  page,
}) => {
  await seedLearnSession(page, {
    dict: 'cet4',
    session: {
      id: 991_001,
      createTime: SESSION_START,
      words: ['cancel', 'analyse'],
      sessionKind: 'mixed',
      itemKinds: { cancel: 'review', analyse: 'acquisition' },
    },
    wordRecords: [
      {
        word: 'cancel',
        timeStamp: SESSION_START + 10,
        learnItemKind: 'review',
        retrievalValidity: 'independent',
        errorCause: 'clean',
      },
      {
        word: 'cancel',
        timeStamp: SESSION_START + 40,
        learnItemKind: 'review',
        retrievalValidity: 'independent',
        errorCause: 'clean',
      },
      {
        word: 'analyse',
        timeStamp: SESSION_START + 20,
        learnItemKind: 'acquisition',
        // Assisted success must never be reported as independent recall.
        retrievalValidity: 'assisted',
        errorCause: 'clean',
      },
    ],
  })

  await page.goto('/learn')
  const beforeReload = await readLearnStrip(page)
  expect(beforeReload[2]).toBe('1新学')
  expect(beforeReload[3]).toBe('1已复习')
  expect(beforeReload[4]).toBe('1独立回忆')

  await page.reload()
  const afterReload = await readLearnStrip(page)
  expect(afterReload[2]).toBe('1新学')
  expect(afterReload[3]).toBe('1已复习')
  expect(afterReload[4]).toBe('1独立回忆')
})

test('Learn 本轮进度 uses terminal item state and ignores a stale queue index', async ({
  page,
}) => {
  await seedLearnSession(page, {
    dict: 'cet4',
    session: {
      id: 991_002,
      createTime: SESSION_START,
      words: ['cancel', 'analyse'],
      sessionKind: 'review',
      // Legacy checkpoint: no per-item metadata, so the consumed queue prefix
      // is the only conservative signal.
      index: 1,
    },
  })

  await page.goto('/learn')
  expect((await readLearnStrip(page))[1]).toBe('1/2本轮进度')

  await seedLearnSession(page, {
    dict: 'cet4',
    session: {
      id: 991_003,
      createTime: SESSION_START,
      words: ['cancel', 'analyse'],
      sessionKind: 'review',
      itemStates: {
        cancel: reviewItemState('done'),
        analyse: reviewItemState('deferred'),
      },
    },
  })

  await page.goto('/learn')
  expect((await readLearnStrip(page))[1]).toBe('2/2本轮进度')
})

test('Learn 学习时间 advances while the session is active', async ({ page }) => {
  await seedLearnSession(page, {
    dict: 'cet4',
    session: {
      id: 991_004,
      createTime: SESSION_START,
      words: ['cancel', 'analyse'],
      sessionKind: 'review',
    },
  })

  await page.goto('/learn')
  await page.getByText('按任意键开始').waitFor()
  expect((await readLearnStrip(page))[0]).toBe('00:00学习时间')

  await page.keyboard.press('a')
  await expect
    .poll(async () => (await readLearnStrip(page))[0], { timeout: 8_000 })
    .not.toBe('00:00学习时间')
})
