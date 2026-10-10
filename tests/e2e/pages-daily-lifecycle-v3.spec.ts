import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import {
  installExplorerBusinessClock,
  advanceIdleBusinessTime,
  readExplorerBusinessTime,
} from './pages-explorer-clock'

const site = 'https://smhe00.github.io/qwerty-learner/'
const sha = process.env.PAGES_SOURCE_SHA
const maximumBlocks = 8
const maximumWordsPerBlock = 35
type State = {
  dict: string
  sessionId: string | null
  cursor: number | null
  finished: boolean
  attemptCount: number
  reviewCount: number
  admittedCount: number
  dateKey: string | null
  dailyStatus: string | null
  dailyTarget: number | null
  nextDeferred: number | null
  minDue: number | null
}
type Trace = { event: string; block: number; attempts: number;
  dateKey: string | null; dailyStatus: string | null; admitted: number }

async function state(page: Page): Promise<State> {
  return page.evaluate(async () => {
    const raw = localStorage.getItem('reviewModeInfo')
    const session = raw ? JSON.parse(raw).reviewRecord : null
    const config = localStorage.getItem('currentDict')
    const dict = config ? JSON.parse(config) : 'shanghai-zhongkao-2027'
    const dailyRaw = localStorage.getItem('qwerty.learn.dailySession.v1.' + dict)
    const daily = dailyRaw ? JSON.parse(dailyRaw) : null
    const dbData = await new Promise<{
      attempts: number; reviews: number; admitted: number; due: number | null;
      deferred: number | null;
    }>((resolve,reject) => {
      const open = indexedDB.open('RecordDB')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction(['wordRecords','reviewRecords','reviewWordStates'],'readonly')
        const histories = tx.objectStore('wordRecords').getAll()
        const sessions = tx.objectStore('reviewRecords').getAll()
        const states = tx.objectStore('reviewWordStates').getAll()
        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => {
          const attempts = histories.result.filter((r: { sourceMode?: string }) =>
            r.sourceMode === 'learn')
          const resumeTimes = sessions.result.flatMap((row: {
            acquisitionStates?: Record<string, { phase?: string; resumeAfter?: number }>
          }) => Object.values(row.acquisitionStates ?? {}).flatMap(st =>
            st.phase === 'deferred' && st.resumeAfter ? [st.resumeAfter] : []))
          const active = states.result.filter((st: { lifecycle?: string }) =>
            st.lifecycle === 'active')
          resolve({
            attempts: attempts.length,
            reviews: attempts.filter((r: { learnItemKind?: string }) =>
              r.learnItemKind === 'review').length,
            admitted: active.length,
            due: active.length ? Math.min(...active.map((s: { nextReviewAt: number }) =>
              s.nextReviewAt)) : null,
            deferred: resumeTimes.length ? Math.min(...resumeTimes) : null,
          })
          db.close()
        }
      }
    })
    return {
      dict,
      sessionId: session ? String(session.id ?? session.createTime ?? '') : null,
      cursor: session?.index ?? null,
      finished: session?.isFinished === true,
      attemptCount: dbData.attempts,
      reviewCount: dbData.reviews,
      admittedCount: dbData.admitted,
      dateKey: daily?.dateKey ?? null,
      dailyStatus: daily?.status ?? null,
      dailyTarget: daily?.dailyNewTarget ?? null,
      nextDeferred: dbData.deferred,
      minDue: dbData.due,
    }
  })
}

async function active(page: Page) {
  await expect(page).toHaveURL(/\/qwerty-learner\/learn\/?$/)
  const pause = page.getByRole('button', { name: '暂停', exact: true })
  if (!(await pause.isVisible().catch(() => false))) {
    const prompt = page.getByText(/按任意键(?:开始|继续)/).first()
    await expect(prompt).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('a')
    await expect(pause).toBeVisible()
    await expect(prompt).toBeHidden()
  }
}

async function finishWord(page: Page, before: State) {
  const node = page.locator('[data-typing-word]:visible').first()
  await expect(node).toHaveAttribute('data-typing-word', /\S+/)
  const spelling = await node.getAttribute('data-typing-word')
  expect(spelling).toBeTruthy()
  await page.keyboard.type(spelling!)
  await expect.poll(async () => {
    const next = await state(page)
    return {
      count: next.attemptCount,
      advanced: next.finished ||
        (next.cursor !== null && before.cursor !== null &&
          next.cursor > before.cursor),
    }
  }, { timeout: 20_000 }).toEqual({
    count: before.attemptCount + 1, advanced: true,
  })
}

test('Explorer V3 P0: daily-complete freezes same-day Learn; next day restores quota and real learning', async ({
  page, request,
}) => {
  test.setTimeout(230_000)
  expect(sha).toMatch(/^[0-9a-f]{40}$/)
  await expect.poll(async () => {
    const r = await request.get(site + 'source-commit.txt', { failOnStatusCode: false })
    return r.ok() ? (await r.text()).trim() : ''
  }, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toBe(sha)
  const trace: Trace[] = []
  const pageErrors: string[] = []
  const cloudRequests: string[] = []
  page.on('pageerror', e => pageErrors.push(e.message))
  page.on('request', r => {
    if (/^\/api\/(auth|sync)(\/|$)/.test(new URL(r.url()).pathname)) {
      cloudRequests.push(new URL(r.url()).pathname)
    }
  })
  const add = (event: string, block: number, s: State) => {
    trace.push({ event, block, attempts: s.attemptCount,
      dateKey: s.dateKey, dailyStatus: s.dailyStatus, admitted: s.admittedCount })
  }

  try {
    await page.goto(site, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '打开设置对话框' }).click()
    await page.getByRole('tab', { name: '记忆参数' }).click()
    const input = page.getByRole('spinbutton', { name: '每日新词目标' })
    await input.fill('1')
    await input.press('Tab')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    let finishedDaily = false
    let clockInstalled = false
    let baselineDateKey: string | null = null
    for (let block = 1; block <= maximumBlocks; block++) {
      await active(page)
      const begin = await state(page)
      baselineDateKey ??= begin.dateKey
      expect(begin.dateKey).toBe(baselineDateKey)
      expect(begin.dailyTarget).toBe(1)
      add('begin-block', block, begin)

      for (let index = 0; index < maximumWordsPerBlock; index++) {
        const before = await state(page)
        if (before.finished) break
        await finishWord(page, before)
        const after = await state(page)
        add('word-committed', block, after)
        if (after.finished) break
      }
      const settled = await state(page)
      expect(settled.finished, 'bounded Block must settle').toBe(true)
      const result = page.locator('[data-learn-result-screen]')
      await expect(result).toBeVisible({ timeout: 20_000 })
      await expect(result.getByText('正在保存本阶段学习状态…'))
        .toBeHidden({ timeout: 20_000 })
      await expect(result.getByRole('alert')).toHaveCount(0)
      const complete = await result.getAttribute('data-learn-daily-complete') === 'true'
      if (complete) {
        await expect(result.getByRole('button', { name: '完成', exact: true }))
          .toBeEnabled()
        await expect.poll(async () => (await state(page)).dailyStatus)
          .toBe('completed')
        finishedDaily = true
        add('daily-complete-durable', block, await state(page))
        await result.getByRole('button', { name: '完成', exact: true }).click()
        await expect(result).toHaveCount(0)
        break
      }
      await expect(result).toHaveAttribute('data-learn-block-pause', 'true')
      await result.getByRole('button', { name: '暂停 Learn' }).click()
      await expect(result).toHaveCount(0)

      // Virtual time cannot be changed while a Learn word is active.
      // First clock initialization is also performed in an idle Typing page.
      if (!clockInstalled) {
        const now = Date.now()
        await installExplorerBusinessClock(page, now)
        clockInstalled = true
      }
      await page.goto(site + 'typing', { waitUntil: 'domcontentloaded' })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByText(/按任意键(?:开始|继续)/).first())
        .toBeVisible()

      const checkpoint = await state(page)
      const now = Math.floor((await readExplorerBusinessTime(page)).dateNow / 1000)
      const step = checkpoint.nextDeferred && checkpoint.nextDeferred > now
        ? checkpoint.nextDeferred - now + 2 : 305
      await advanceIdleBusinessTime(page, step)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Learn', exact: true }).click()
      add('deferred-cooling-complete', block, await state(page))
    }
    expect(finishedDaily, 'real independent clean admission must complete daily target')
      .toBe(true)
    const complete = await state(page)
    expect(complete.dailyStatus).toBe('completed')
    expect(complete.admittedCount).toBeGreaterThan(0)
    const id = complete.sessionId
    const count = complete.attemptCount
    add('same-day-before-retry', 0, complete)

    await page.getByRole('button', { name: '开始 Learn' }).click()
    await expect(page.getByRole('status')).toContainText('今日 Learn 目标已完成')
    const denied = await state(page)
    expect(denied.sessionId).toBe(id)
    expect(denied.attemptCount).toBe(count)
    expect(denied.dailyStatus).toBe('completed')
    add('same-day-retry-blocked', 0, denied)

    // Virtual next day: retain scheduler records; only Date offset changes.
    await page.goto(site + 'typing', { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/按任意键(?:开始|继续)/).first())
      .toBeVisible()
    if (!clockInstalled) {
      await installExplorerBusinessClock(page, Date.now())
      await page.reload({ waitUntil: 'domcontentloaded' })
      clockInstalled = true
    }
    await advanceIdleBusinessTime(page, 86_400 + 600)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    await page.getByRole('button', { name: '开始 Learn' }).click()
    await active(page)
    const tomorrow = await state(page)
    expect(tomorrow.dateKey).not.toBe(complete.dateKey)
    expect(tomorrow.dailyTarget).toBe(1)
    expect(tomorrow.dailyStatus).toBe('active')
    expect(tomorrow.sessionId).not.toBe(id)
    expect(tomorrow.attemptCount).toBe(count)
    await finishWord(page, tomorrow)
    const after = await state(page)
    expect(after.attemptCount).toBe(count + 1)
    add('new-day-word-committed', 0, after)
    expect(pageErrors).toEqual([])
    expect(cloudRequests).toEqual([])
  } finally {
    const outfile = test.info().outputPath('pages-daily-lifecycle-v3-redacted.json')
    writeFileSync(outfile, JSON.stringify({
      schema: 'pages-daily-lifecycle-v3-v1',
      sourceSha: sha, trace, errors: pageErrors.length,
      cloudCalls: cloudRequests.length,
    }, null, 2))
    await test.info().attach('pages-daily-lifecycle-v3-redacted.json', {
      path: outfile, contentType: 'application/json',
    })
  }
})
