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
    const dict = dictRaw ? JSON.parse(dictRaw) : 'hujiaoxin2027'
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
  if (await prompt.isVisible().catch(() => false)) {
    await page.keyboard.press('a')
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
  await installExplorerBusinessClock(page)
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
    const clockStart = await readExplorerBusinessTime(page)
    expect(clockStart.dateNow).toBe(clockStart.clockNow)

    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    const first = await readyToType(page)
    const before = await state(page)
    expect(before.id).toBeTruthy()
    expect(before.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    log('day-0-before-spelling', before)

    await page.keyboard.type(first)
    await expect.poll(async () => {
      const latest = await state(page)
      return latest.cursor === 1 && latest.rows === 1 && latest.durableCursor === 1
    }, { timeout: 20_000 }).toBe(true)
    const checkpoint = await state(page)
    expect(checkpoint.finished).toBe(false)
    log('first-word-durable', checkpoint)

    // Leave Learn: V3 never changes virtual time while a Learn attempt is live.
    await page.getByRole('button', { name: 'Typing', exact: true }).click()
    await expect(page).toHaveURL(/\/qwerty-learner\/typing\/?$/)
    await expect(page.getByText(/按任意键(?:开始|继续)/).first()).toBeVisible()
    const jumped = await advanceIdleBusinessTime(page, 2 * DAY + 600)
    expect(jumped.after - jumped.before).toBe((2 * DAY + 600) * 1000)

    // Time must survive a full SPA bootstrap, not only a mutable tab-global.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
    const rebootTime = await readExplorerBusinessTime(page)
    expect(rebootTime.clockNow).toBe(jumped.after)
    expect(rebootTime.dateNow).toBe(jumped.after)
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
      clockModel: 'test-only Date/Date.now proxy, physical timers unchanged',
      trace,
      pageErrorCount: errors.length,
    }, null, 2))
    await test.info().attach('pages-v3-idle-time-jump-redacted.json', {
      path, contentType: 'application/json',
    })
  }
})
