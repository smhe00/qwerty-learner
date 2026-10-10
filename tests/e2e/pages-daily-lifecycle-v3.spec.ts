import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { advanceIdleBusinessTime, installExplorerBusinessClock } from './pages-explorer-clock'

const site = 'https://smhe00.github.io/qwerty-learner/'
const sha = process.env.PAGES_SOURCE_SHA
const MAX_BLOCKS = 12
const MAX_STEPS = 65

type Snapshot = {
  blockId: string | null
  index: number | null
  blockFinished: boolean
  wordRows: number
  dailyId: string | null
  dailyDate: string | null
  dailyStatus: string | null
  dailyNewTarget: number
  plannedNewWords: number
  plannedReviewCount: number
  targetDueWord: string | null
  targetReviewAt: number | null
  targetReviewCount: number | null
  currentWord: string | null
  currentKind: string | null
  currentWords: string[]
}

async function snapshot(page: Page, target: string | null): Promise<Snapshot> {
  return page.evaluate(async (targetWord) => {
    const raw = localStorage.getItem('reviewModeInfo')
    const active = raw ? JSON.parse(raw).reviewRecord : null
    const dictRaw = localStorage.getItem('currentDict')
    const dict = active?.dict ?? (dictRaw ? JSON.parse(dictRaw) : 'shanghai-zhongkao-2027')
    const dailyRaw = localStorage.getItem('qwerty.learn.dailySession.v1.' + dict)
    const daily = dailyRaw ? JSON.parse(dailyRaw) : null

    const data = await new Promise<{
      count: number
      states: Array<{ word: string; nextReviewAt: number; reviewCount?: number; lifecycle?: string }>
    }>((resolve, reject) => {
      const opened = indexedDB.open('RecordDB')
      opened.onerror = () => reject(opened.error)
      opened.onsuccess = () => {
        const db = opened.result
        const tx = db.transaction(['wordRecords', 'reviewWordStates'], 'readonly')
        const records = tx.objectStore('wordRecords').getAll()
        const states = tx.objectStore('reviewWordStates').getAll()
        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => {
          resolve({
            count: records.result.filter((r: { sourceMode?: string }) => r.sourceMode === 'learn').length,
            states: states.result,
          })
          db.close()
        }
      }
    })
    const admission = targetWord
      ? data.states.find(r => r.word === targetWord && r.lifecycle === 'active')
      : data.states.find(r => r.lifecycle === 'active' && Number.isFinite(r.nextReviewAt))
    const activeIndex = active?.index ?? null
    const item = activeIndex === null ? null : active.words?.[activeIndex]
    const itemKind = item?.name ? active.itemKinds?.[item.name] ?? active.sessionKind : null
    return {
      blockId: active ? String(active.id ?? active.createTime ?? '') : null,
      index: activeIndex,
      blockFinished: active?.isFinished === true,
      wordRows: data.count,
      dailyId: daily?.sessionId ?? null,
      dailyDate: daily?.dateKey ?? null,
      dailyStatus: daily?.status ?? null,
      dailyNewTarget: daily?.dailyNewTarget ?? 0,
      plannedNewWords: daily?.plannedNewWords ?? 0,
      plannedReviewCount: daily?.plannedReviewWords?.length ?? 0,
      targetDueWord: admission?.word ?? null,
      targetReviewAt: admission?.nextReviewAt ?? null,
      targetReviewCount: admission?.reviewCount ?? null,
      currentWord: item?.name ?? null,
      currentKind: itemKind,
      currentWords: active?.words?.map((w: { name: string }) => w.name) ?? [],
    }
  }, target)
}

async function startTypingLearn(page: Page) {
  const pause = page.getByRole('button', { name: '暂停', exact: true })
  if (!(await pause.isVisible().catch(() => false))) {
    const prompt = page.getByText(/按任意键(?:开始|继续)/).first()
    await expect(prompt).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('a')
    await expect(pause).toBeVisible()
    await expect(prompt).toBeHidden()
  }
}

async function learnOneWord(page: Page, before: Snapshot) {
  const node = page.locator('[data-typing-word]:visible').first()
  await expect(node).toHaveAttribute('data-typing-word', /\S+/)
  const word = await node.getAttribute('data-typing-word')
  expect(word).toBeTruthy()
  await page.keyboard.type(word!)
  await expect.poll(async () => {
    const after = await snapshot(page, null)
    return after.wordRows === before.wordRows + 1 &&
      (after.blockFinished || after.index !== before.index)
  }, { timeout: 20_000 }).toBe(true)
}

test('Explorer V3 P0: daily target completes, same-day reentry blocks, next-day due review and new quota', async ({
  page, request,
}) => {
  test.setTimeout(300_000)
  expect(sha).toMatch(/^[a-f0-9]{40}$/)
  await expect.poll(async () => {
    const response = await request.get(site + 'source-commit.txt', { failOnStatusCode: false })
    return response.ok() ? (await response.text()).trim() : ''
  }, { intervals: [1000, 2000, 5000], timeout: 90_000 }).toBe(sha)

  const trail: Array<{
    step: string; blockCount: number; rows: number; date: string | null;
    newTarget: number; plannedReviews: number; dailyStatus: string | null;
  }> = []
  const errors: string[] = []
  const cloud: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => {
    const path = new URL(r.url()).pathname
    if (/^\/api\/(auth|sync)(\/|$)/.test(path)) cloud.push(path)
  })
  let blocks = 0
  let clockInstalled = false
  const mark = (name: string, s: Snapshot) => trail.push({
    step: name, blockCount: blocks, rows: s.wordRows, date: s.dailyDate,
    newTarget: s.plannedNewWords, plannedReviews: s.plannedReviewCount,
    dailyStatus: s.dailyStatus,
  })

  try {
    await page.goto(site, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '打开设置对话框' }).click()
    await page.getByRole('tab', { name: '记忆参数' }).click()
    const quota = page.getByRole('spinbutton', { name: '每日新词目标' })
    await quota.fill('1')
    await quota.press('Tab')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Learn', exact: true }).click()

    let completed: Snapshot | null = null
    let dateBefore: string | null = null
    let firstBlockId: string | null = null

    for (let block = 0; block < MAX_BLOCKS; block++) {
      await startTypingLearn(page)
      const opened = await snapshot(page, null)
      blocks++
      expect(opened.blockId).toBeTruthy()
      if (!firstBlockId) firstBlockId = opened.blockId
      if (!dateBefore) dateBefore = opened.dailyDate
      expect(opened.dailyDate).toBe(dateBefore)
      expect(opened.plannedNewWords).toBe(1)
      mark('block-enter', opened)

      let stopped = false
      for (let step = 0; step < MAX_STEPS; step++) {
        const before = await snapshot(page, null)
        if (before.blockFinished) { stopped = true; break }
        await learnOneWord(page, before)
        if ((await snapshot(page, null)).blockFinished) { stopped = true; break }
      }
      expect(stopped, 'actual Learn Block must reach settlement without no-op').toBe(true)
      const result = page.locator('[data-learn-result-screen]')
      await expect(result).toBeVisible({ timeout: 20_000 })
      await expect(result.getByText('正在保存本阶段学习状态…')).toBeHidden({
        timeout: 20_000,
      })
      await expect(result.getByRole('alert')).toHaveCount(0)
      const end = await snapshot(page, null)
      mark('block-settled', end)

      if (await result.getAttribute('data-learn-daily-complete') === 'true') {
        expect(end.dailyStatus).toBe('completed')
        await expect(result.getByRole('button', { name: '完成', exact: true })).toBeEnabled()
        completed = end
        await result.getByRole('button', { name: '完成', exact: true }).click()
        break
      }
      await expect(result).toHaveAttribute('data-learn-block-pause', 'true')
      await result.getByRole('button', { name: '暂停 Learn' }).click()
      await expect(result).toHaveCount(0)

      // Time-warp is introduced at a settled, inactive checkpoint, never
      // during real typing. A five-minute jump releases spacing/assistance.
      if (!clockInstalled) {
        await installExplorerBusinessClock(page, Date.now())
        clockInstalled = true
      }
      await page.goto(site + 'typing', { waitUntil: 'domcontentloaded' })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByText(/按任意键(?:开始|继续)/).first()).toBeVisible()
      await advanceIdleBusinessTime(page, 360)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Learn', exact: true }).click()
      // This path MUST remain the same virtual date.
    }

    expect(completed, 'eventually earn daily completion by real independent spelling')
      .not.toBeNull()
    const end = completed!
    expect(end.blockId).toBeTruthy()
    expect(end.dailyId).toBeTruthy()
    expect(end.dailyStatus).toBe('completed')
    expect(end.dailyNewTarget).toBe(1)
    mark('daily-completed', end)

    // Explicit Start on the same virtual day must not create a new Block.
    await expect(page.getByRole('button', { name: '开始 Learn' })).toBeVisible()
    await page.getByRole('button', { name: '开始 Learn' }).click()
    await expect(page.getByRole('status').getByText('今日 Learn 目标已完成。'))
      .toBeVisible({ timeout: 20_000 })
    const forbidden = await snapshot(page, null)
    expect(forbidden.dailyId).toBe(end.dailyId)
    expect(forbidden.dailyStatus).toBe('completed')
    expect(forbidden.wordRows).toBe(end.wordRows)
    expect(forbidden.blockId).toBe(end.blockId)
    await expect(page.locator('[data-learn-result-screen]')).toHaveCount(0)
    mark('same-day-start-blocked', forbidden)

    // Find a naturally scheduled due word, using production scheduler data.
    await expect.poll(async () => {
      const current = await snapshot(page, null)
      return current.targetDueWord !== null && current.targetReviewAt !== null
    }, { timeout: 20_000 }).toBe(true)
    const due = await snapshot(page, null)
    expect(due.targetDueWord).toBeTruthy()
    expect(due.targetReviewAt).toBeGreaterThan(0)
    const scheduledWord = due.targetDueWord!
    const priorReviewCount = due.targetReviewCount

    // Move the isolated browser past both tomorrow and actual FSRS due.
    await page.goto(site + 'typing', { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/按任意键(?:开始|继续)/).first()).toBeVisible()
    const virtualNow = Math.floor(await page.evaluate(() => Date.now() / 1000))
    const jump = Math.max(86_400 + 30, due.targetReviewAt! - virtualNow + 90)
    expect(jump).toBeLessThanOrEqual(44 * 86400)
    await advanceIdleBusinessTime(page, jump)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    // Landing may auto-start based on router state; explicitly handle Start.
    const start = page.getByRole('button', { name: '开始 Learn' })
    if (await start.isVisible().catch(() => false)) await start.click()
    await startTypingLearn(page)
    const tomorrow = await snapshot(page, scheduledWord)
    expect(tomorrow.dailyId).not.toBe(end.dailyId)
    expect(tomorrow.dailyDate).not.toBe(end.dailyDate)
    expect(tomorrow.dailyStatus).toBe('active')
    expect(tomorrow.plannedNewWords).toBe(1)
    expect(tomorrow.plannedReviewCount).toBeGreaterThanOrEqual(1)
    expect(tomorrow.currentWords).toContain(scheduledWord)
    expect(tomorrow.currentKind, 'naturally due review takes priority over acquisition')
      .toBe('review')
    mark('next-day-due-priority-and-new-quota', tomorrow)

    await learnOneWord(page, tomorrow)
    await expect.poll(async () => {
      const state = await snapshot(page, scheduledWord)
      return state.targetReviewCount !== null &&
        priorReviewCount !== null && state.targetReviewCount > priorReviewCount
    }, { timeout: 20_000 }).toBe(true)
    const afterDue = await snapshot(page, scheduledWord)
    expect(afterDue.targetReviewAt).toBeGreaterThan(Math.floor(
      await page.evaluate(() => Date.now() / 1000)))
    expect(afterDue.wordRows).toBe(tomorrow.wordRows + 1)
    mark('fsrs-due-review-durable', afterDue)
    expect(errors).toEqual([])
    expect(cloud).toEqual([])
  } finally {
    const path = test.info().outputPath('pages-v3-daily-lifecycle-redacted.json')
    writeFileSync(path, JSON.stringify({
      schema: 'pages-v3-daily-lifecycle-v1', sourceSha: sha,
      blocks, trail, pageErrorCount: errors.length, cloudCalls: cloud.length,
    }, null, 2))
    await test.info().attach('pages-v3-daily-lifecycle-redacted.json', {
      path, contentType: 'application/json',
    })
  }
})
