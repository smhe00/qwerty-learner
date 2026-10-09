import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import {
  advanceIdleBusinessTime,
  installExplorerBusinessClock,
  readExplorerBusinessTime,
} from './pages-explorer-clock'

const site = 'https://smhe00.github.io/qwerty-learner/'
const sha = process.env.PAGES_SOURCE_SHA
const DAY = 86_400

type State = {
  id: string | null
  cursor: number | null
  finished: boolean
  rows: number
  durableCursor: number | null
  dateKey: string | null
}

async function state(page: Page): Promise<State> {
  return page.evaluate(async () => {
    const raw = localStorage.getItem('reviewModeInfo')
    const session = raw ? JSON.parse(raw).reviewRecord : null
    const dictRaw = localStorage.getItem('currentDict')
    const dict = dictRaw ? JSON.parse(dictRaw) : 'shanghai-zhongkao-2027'
    const dailyRaw = localStorage.getItem('qwerty.learn.dailySession.v1.' + dict)
    const daily = dailyRaw ? JSON.parse(dailyRaw) : null
    const id = session ? String(session.id ?? session.createTime ?? '') : null
    const dbState = await new Promise<{ rows: number; cursor: number | null }>((resolve, reject) => {
      const req = indexedDB.open('RecordDB')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['wordRecords', 'reviewRecords'], 'readonly')
        const words = tx.objectStore('wordRecords').getAll()
        const sessions = tx.objectStore('reviewRecords').getAll()
        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => {
          const matching = sessions.result.find((row: { id?: number; createTime?: number }) =>
            String(row.id ?? row.createTime ?? '') === id)
          resolve({
            rows: words.result.filter((row: { sourceMode?: string }) => row.sourceMode === 'learn').length,
            cursor: matching?.index ?? null,
          })
          db.close()
        }
      }
    })
    return {
      id,
      cursor: session?.index ?? null,
      finished: session?.isFinished === true,
      rows: dbState.rows,
      durableCursor: dbState.cursor,
      dateKey: daily?.dateKey ?? null,
    }
  })
}

async function readyToType(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/qwerty-learner\/learn\/?$/)
  const prompt = page.getByText(/按任意键(?:开始|继续)/).first()
  const pause = page.getByRole('button', { name: '暂停', exact: true })
  // Learn session preparation is asynchronous. An immediate isVisible()
  // probe can return false before the idle prompt even mounts; typing then
  // goes to an inactive keyboard handler and produces zero records.
  if (!(await pause.isVisible().catch(() => false))) {
    await expect(prompt).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('a')
    await expect(pause).toBeVisible()
    await expect(prompt).toBeHidden()
  }
  const wordNode = page.locator('[data-typing-word]:visible').first()
  await expect(wordNode).toHaveAttribute('data-typing-word', /\S+/)
  await expect.poll(async () => {
    if (await wordNode.getAttribute('data-typing-locked') === 'true') return false
    if (await wordNode.getAttribute('data-typing-finished') === 'true') return false
    return true
  }).toBe(true)
  const word = await wordNode.getAttribute('data-typing-word')
  if (!word) throw new Error('Missing current Learn spelling word')
  return word
}

test('Explorer V3: 48-hour idle jump preserves unfinished Learn block and real durable history', async ({
  page, request,
}) => {
  test.setTimeout(180_000)
  expect(sha).toMatch(/^[a-f0-9]{40}$/)
  await expect.poll(async () => {
    const response = await request.get(site + 'source-commit.txt', { failOnStatusCode: false })
    return response.ok() ? (await response.text()).trim() : ''
  }, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toBe(sha)

  const trace: Array<{ action: string; cursor: number | null; rows: number; dateKey: string | null }> = []
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const log = (action: string, value: State) =>
    trace.push({ action, cursor: value.cursor, rows: value.rows, dateKey: value.dateKey })

  try {
    await page.goto(site, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    const first = await readyToType(page)
    // Observe the pre-attempt checkpoint without opening a second raw
    // IndexedDB connection while the active Word keyboard engine is mounting.
    // All durable assertions below still read native IndexedDB.
    const before = await page.evaluate(() => {
      const raw = localStorage.getItem('reviewModeInfo')
      const row = raw ? JSON.parse(raw).reviewRecord : null
      const dictRaw = localStorage.getItem('currentDict')
      const dict = dictRaw ? JSON.parse(dictRaw) : 'shanghai-zhongkao-2027'
      const dailyRaw = localStorage.getItem('qwerty.learn.dailySession.v1.' + dict)
      const daily = dailyRaw ? JSON.parse(dailyRaw) : null
      return {
        id: row ? String(row.id ?? row.createTime ?? '') : null,
        cursor: row?.index ?? null,
        finished: row?.isFinished === true,
        rows: 0, durableCursor: 0,
        dateKey: daily?.dateKey ?? null,
      }
    })
    expect(before.id).toBeTruthy()
    expect(before.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    log('day-0-before-spelling', before)

    await page.keyboard.type(first)
    await expect.poll(async () => {
      const latest = await state(page)
      return { cursor: latest.cursor, rows: latest.rows, durableCursor: latest.durableCursor }
    }, { timeout: 20_000 }).toEqual({ cursor: 1, rows: 1, durableCursor: 1 })
    const checkpoint = await state(page)
    expect(checkpoint.finished).toBe(false)
    log('first-word-durable', checkpoint)

    // Bootstrap the isolated virtual clock only AFTER a real unmodified
    // Learn attempt is durable. Clock code is installed on the next reload.
    // This makes any clock/typing incompatibility unambiguous.
    await installExplorerBusinessClock(page, Date.now())
    await page.getByRole('button', { name: 'Typing', exact: true }).click()
    await expect(page).toHaveURL(/\/qwerty-learner\/typing\/?$/)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/按任意键(?:开始|继续)/).first()).toBeVisible()
    const clockStart = await readExplorerBusinessTime(page)
    expect(Math.abs(clockStart.dateNow - clockStart.clockNow)).toBeLessThan(1000)
    const jumped = await advanceIdleBusinessTime(page, 2 * DAY + 600)
    expect(Math.abs(jumped.after - jumped.before - (2 * DAY + 600) * 1000)).toBeLessThan(1000)

    // Time must survive a full SPA bootstrap, not only a mutable tab-global.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
    const rebootTime = await readExplorerBusinessTime(page)
    expect(rebootTime.clockNow).toBeGreaterThanOrEqual(jumped.after)
    expect(rebootTime.clockNow - jumped.after).toBeLessThan(20_000)
    expect(Math.abs(rebootTime.dateNow - rebootTime.clockNow)).toBeLessThan(1000)
    log('virtual-two-days-after-idle', await state(page))

    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    await expect(page).toHaveURL(/\/qwerty-learner\/learn\/?$/)
    await expect.poll(async () => {
      const resumed = await state(page)
      return resumed.id === checkpoint.id &&
        resumed.cursor === checkpoint.cursor &&
        resumed.durableCursor === checkpoint.durableCursor &&
        resumed.rows === checkpoint.rows &&
        resumed.dateKey !== checkpoint.dateKey &&
        Boolean(resumed.dateKey)
    }, { timeout: 20_000 }).toBe(true)
    const resumed = await state(page)
    log('new-day-old-block-resumed', resumed)

    const second = await readyToType(page)
    await page.keyboard.type(second)
    await expect.poll(async () => {
      const saved = await state(page)
      return saved.cursor === 2 && saved.durableCursor === 2 && saved.rows === 2
    }, { timeout: 20_000 }).toBe(true)
    log('second-word-on-next-day-durable', await state(page))

    expect(page.url()).not.toContain('~and~')
    expect(errors).toEqual([])
  } finally {
    const path = test.info().outputPath('pages-v3-idle-time-jump-redacted.json')
    writeFileSync(path, JSON.stringify({
      schema: 'pages-v3-idle-time-jump-v1',
      sourceSha: sha,
      clockModel: 'test-only moving Date/Date.now offset, native physical timers unchanged',
      trace,
      pageErrorCount: errors.length,
    }, null, 2))
    await test.info().attach('pages-v3-idle-time-jump-redacted.json', {
      path, contentType: 'application/json',
    })
  }
})
