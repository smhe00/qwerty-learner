import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import {
  advanceIdleBusinessTime,
  installExplorerBusinessClock,
} from './pages-explorer-clock'

const site = 'https://smhe00.github.io/qwerty-learner/'
const sha = process.env.PAGES_SOURCE_SHA
const MAX_ATTEMPTS_PER_BLOCK = 110
const TARGET_BLOCKS = 2

type LearnCheckpoint = {
  sessionId: string | null
  index: number | null
  finished: boolean
  wordCount: number
  storedIndex: number | null
  storedFinished: boolean | null
  attempts: number
  admitted: number
}
type Evidence = {
  block: number
  attempt: number
  action: string
  index: number | null
  totalAttempts: number
  admitted: number
  finished: boolean
}

async function checkpoint(page: Page): Promise<LearnCheckpoint> {
  return page.evaluate(async () => {
    const raw = localStorage.getItem('reviewModeInfo')
    const current = raw ? JSON.parse(raw).reviewRecord : null
    const id = current ? String(current.id ?? current.createTime ?? '') : null
    const dbData = await new Promise<{
      index: number | null
      finished: boolean | null
      rows: number
      admitted: number
    }>((resolve, reject) => {
      const req = indexedDB.open('RecordDB')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const transaction = db.transaction(
          ['reviewRecords', 'wordRecords', 'reviewWordStates'], 'readonly')
        const sessions = transaction.objectStore('reviewRecords').getAll()
        const records = transaction.objectStore('wordRecords').getAll()
        const states = transaction.objectStore('reviewWordStates').getAll()
        transaction.onerror = () => reject(transaction.error)
        transaction.oncomplete = () => {
          const saved = sessions.result.find((row: { id?: number; createTime?: number }) =>
            String(row.id ?? row.createTime ?? '') === id)
          resolve({
            index: saved?.index ?? null,
            finished: saved?.isFinished ?? null,
            rows: records.result.filter((row: { sourceMode?: string }) =>
              row.sourceMode === 'learn').length,
            admitted: states.result.filter((row: { lifecycle?: string }) =>
              row.lifecycle === 'active').length,
          })
          db.close()
        }
      }
    })
    return {
      sessionId: id,
      index: current?.index ?? null,
      finished: current?.isFinished === true,
      wordCount: current?.words?.length ?? 0,
      storedIndex: dbData.index,
      storedFinished: dbData.finished,
      attempts: dbData.rows,
      admitted: dbData.admitted,
    }
  })
}

async function startActiveLearn(page: Page) {
  await expect(page).toHaveURL(/\/qwerty-learner\/learn\/?$/)
  const pause = page.getByRole('button', { name: '暂停', exact: true })
  const prompt = page.getByText(/按任意键(?:开始|继续)/).first()
  if (!(await pause.isVisible().catch(() => false))) {
    await expect(prompt).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('a')
    await expect(pause).toBeVisible()
    await expect(prompt).toBeHidden()
  }
}

async function spellCurrent(page: Page, before: LearnCheckpoint) {
  const wordNode = page.locator('[data-typing-word]:visible').first()
  await expect(wordNode).toHaveAttribute('data-typing-word', /\S+/)
  const word = await wordNode.getAttribute('data-typing-word')
  expect(word).toBeTruthy()

  // Only use ESC in an eligible managed recall exercise.
  const letters = await wordNode.getAttribute('data-review-letters')
  if (letters !== 'all-visible' && before.index !== null &&
      before.index % 7 === 2) {
    await page.keyboard.press('Escape')
    await expect(wordNode).toHaveAttribute('data-review-hint-level', '3')
  }

  await page.keyboard.type(word!)
  await expect.poll(async () => {
    const next = await checkpoint(page)
    return {
      rows: next.attempts,
      persisted: next.index === next.storedIndex &&
        next.finished === next.storedFinished,
      progressed: next.finished || (next.index !== null &&
        before.index !== null && next.index > before.index),
    }
  }, { timeout: 20_000 }).toEqual({
    rows: before.attempts + 1,
    persisted: true,
    progressed: true,
  })
}

test('Explorer V3: finish two genuine Learn blocks across a virtual day with durable records', async ({
  page, request,
}) => {
  test.setTimeout(240_000)
  expect(sha).toMatch(/^[a-f0-9]{40}$/)
  await expect.poll(async () => {
    const r = await request.get(site + 'source-commit.txt', { failOnStatusCode: false })
    return r.ok() ? (await r.text()).trim() : ''
  }, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toBe(sha)

  const evidence: Evidence[] = []
  const completedIds = new Set<string>()
  const errors: string[] = []
  const cloudCalls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (/^\/api\/(auth|sync)(\/|$)/.test(new URL(request.url()).pathname)) {
      cloudCalls.push(request.url())
    }
  })
  const add = (block: number, attempt: number, action: string, c: LearnCheckpoint) => {
    evidence.push({
      block, attempt, action, index: c.index, totalAttempts: c.attempts,
      admitted: c.admitted, finished: c.finished,
    })
  }

  try {
    await page.goto(site, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '打开设置对话框' }).click()
    await page.getByRole('tab', { name: '记忆参数' }).click()
    const quota = page.getByRole('spinbutton', { name: '每日新词目标' })
    await quota.fill('6')
    await quota.press('Tab')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    await startActiveLearn(page)

    let totalCompletedAttempts = 0
    for (let block = 1; block <= TARGET_BLOCKS; block++) {
      await startActiveLearn(page)
      const entry = await checkpoint(page)
      expect(entry.sessionId).toBeTruthy()
      expect(entry.finished).toBe(false)
      expect(completedIds.has(entry.sessionId!)).toBe(false)
      add(block, 0, 'block-enter', entry)

      let done = false
      for (let i = 0; i < MAX_ATTEMPTS_PER_BLOCK; i++) {
        const before = await checkpoint(page)
        expect(before.sessionId).toBe(entry.sessionId)
        if (before.finished) {
          done = true
          break
        }
        await spellCurrent(page, before)
        const after = await checkpoint(page)
        totalCompletedAttempts++
        add(block, i + 1, 'committed', after)

        // Verify storage survives reload mid-block without replaying a word.
        if (i === 2) {
          await page.reload({ waitUntil: 'domcontentloaded' })
          await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
          await expect.poll(async () => {
            const saved = await checkpoint(page)
            return { id: saved.sessionId, index: saved.index, rows: saved.attempts }
          }).toEqual({
            id: entry.sessionId, index: after.index, rows: after.attempts,
          })
          add(block, i + 1, 'reload-idempotent', await checkpoint(page))
          await startActiveLearn(page)
        }
        if (after.finished) {
          done = true
          break
        }
      }
      expect(done, 'a Learn block cannot stall after repeated successful spelling')
        .toBe(true)
      const completed = await checkpoint(page)
      expect(completed.finished).toBe(true)
      expect(completed.storedFinished).toBe(true)
      completedIds.add(entry.sessionId!)
      add(block, totalCompletedAttempts, 'block-complete', completed)
      // Learn deliberately renders its own settlement screen (not the
      // upstream Typing ResultScreen). Verify the durable settlement barrier
      // and the correct block-pause vs daily-complete state.
      const resultScreen = page.locator('[data-learn-result-screen]')
      await expect(resultScreen).toBeVisible({ timeout: 20_000 })
      await expect(
        resultScreen.getByText('正在保存本阶段学习状态…'),
      ).toBeHidden({ timeout: 20_000 })
      await expect(resultScreen.getByRole('alert')).toHaveCount(0)
      const dailyComplete = await resultScreen.getAttribute('data-learn-daily-complete') === 'true'
      if (dailyComplete) {
        await expect(resultScreen.getByRole('button', { name: '完成', exact: true })).toBeEnabled()
      } else {
        await expect(resultScreen.getByRole('button', { name: '按任意键继续' })).toBeEnabled()
      }
      add(block, totalCompletedAttempts,
        dailyComplete ? 'daily-settlement-complete' : 'block-settlement-pause',
        await checkpoint(page))

      if (block === TARGET_BLOCKS) break

      // Closing the Learn result preserves the completed Block and exits
      // the active typing engine, so virtual time can safely advance.
      await resultScreen.getByRole('button', { name: '暂停 Learn' }).click()
      await expect(resultScreen).toHaveCount(0)

      // End-of-block is a safe point for virtual-time acceleration.
      // Never change the clock while Learn is accepting text.
      await installExplorerBusinessClock(page, Date.now())
      await page.goto(site + 'typing', { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(/按任意键(?:开始|继续)/).first()).toBeVisible()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByText(/按任意键(?:开始|继续)/).first()).toBeVisible()
      await advanceIdleBusinessTime(page, 2 * 86_400 + 600)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Learn', exact: true }).click()
    }

    expect(completedIds.size).toBe(TARGET_BLOCKS)
    expect(totalCompletedAttempts).toBeGreaterThanOrEqual(12)
    expect(errors).toEqual([])
    expect(cloudCalls).toEqual([])
    expect(page.url()).not.toContain('~and~')
  } finally {
    const path = test.info().outputPath('pages-multiblock-v3-redacted.json')
    writeFileSync(path, JSON.stringify({
      schema: 'pages-multiblock-v3-v1',
      sourceSha: sha,
      targetBlocks: TARGET_BLOCKS,
      maximumAttemptsPerBlock: MAX_ATTEMPTS_PER_BLOCK,
      completedBlocks: completedIds.size,
      evidence,
      pageErrorCount: errors.length,
      cloudCallCount: cloudCalls.length,
    }, null, 2))
    await test.info().attach('pages-multiblock-v3-redacted.json', {
      path, contentType: 'application/json',
    })
  }
})


/**
 * Same-day continuation is distinct from a new-day Start: Continue must
 * preserve the daily ledger, allocate another Block, and commit its first word.
 */
test('Explorer V3 coverage: same-day Block pause continues into a second block', async ({
  page, request,
}) => {
  test.setTimeout(210_000)
  expect(sha).toMatch(/^[a-f0-9]{40}$/)
  await expect.poll(async () => {
    const response = await request.get(site + 'source-commit.txt', { failOnStatusCode: false })
    return response.ok() ? (await response.text()).trim() : ''
  }, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toBe(sha)
  const trail: Evidence[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(site, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '打开设置对话框' }).click()
    await page.getByRole('tab', { name: '记忆参数' }).click()
    const quota = page.getByRole('spinbutton', { name: '每日新词目标' })
    await quota.fill('32')
    await quota.press('Tab')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    await startActiveLearn(page)
    const initial = await checkpoint(page)
    expect(initial.sessionId).toBeTruthy()
    let completionCount = 0
    for (let i = 0; i < MAX_ATTEMPTS_PER_BLOCK; i++) {
      const before = await checkpoint(page)
      if (before.finished) break
      await spellCurrent(page, before)
      completionCount++
      const after = await checkpoint(page)
      trail.push({
        block: 1, attempt: completionCount, action: 'committed',
        index: after.index, totalAttempts: after.attempts,
        admitted: after.admitted, finished: after.finished,
      })
      if (after.finished) break
    }
    const finished = await checkpoint(page)
    expect(finished.finished, 'Block must terminate within the bounded exploration').toBe(true)
    expect(finished.storedFinished).toBe(true)
    const result = page.locator('[data-learn-result-screen]')
    await expect(result).toBeVisible({ timeout: 20_000 })
    await expect(result.getByText('正在保存本阶段学习状态…')).toBeHidden({
      timeout: 20_000,
    })
    await expect(result).toHaveAttribute('data-learn-block-pause', 'true')
    await expect(result).not.toHaveAttribute('data-learn-daily-complete', 'true')
    const action = result.getByRole('button', { name: '按任意键继续' })
    await expect(action).toBeEnabled()
    await action.click()
    await startActiveLearn(page)
    const next = await checkpoint(page)
    expect(next.sessionId).toBeTruthy()
    expect(next.sessionId).not.toBe(initial.sessionId)
    expect(next.finished).toBe(false)
    expect(next.attempts).toBe(finished.attempts)
    await spellCurrent(page, next)
    const committed = await checkpoint(page)
    expect(committed.attempts).toBe(next.attempts + 1)
    trail.push({
      block: 2, attempt: 1, action: 'same-day-continued-committed',
      index: committed.index, totalAttempts: committed.attempts,
      admitted: committed.admitted, finished: committed.finished,
    })
    expect(errors).toEqual([])
  } finally {
    const target = test.info().outputPath('pages-v3-same-day-continue-redacted.json')
    writeFileSync(target, JSON.stringify({
      schema: 'pages-v3-same-day-continue-v1',
      publishedSha: sha, trail, pageErrorCount: errors.length,
    }, null, 2))
    await test.info().attach('pages-v3-same-day-continue-redacted.json', {
      path: target, contentType: 'application/json',
    })
  }
})
