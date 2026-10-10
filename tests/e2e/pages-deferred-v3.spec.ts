import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import {
  installExplorerBusinessClock,
  advanceIdleBusinessTime,
} from './pages-explorer-clock'

const site = 'https://smhe00.github.io/qwerty-learner/'
const sha = process.env.PAGES_SOURCE_SHA

type SessionView = {
  id: string | null
  index: number | null
  finished: boolean
  current: string | null
  phase: string | null
  cycles: number
  deferredReason: string | null
  resumeAfter: number | null
}

async function session(page: Page, tracked?: string): Promise<SessionView> {
  return page.evaluate((name) => {
    const raw = localStorage.getItem('reviewModeInfo')
    const active = raw ? JSON.parse(raw).reviewRecord : null
    const state = name ? active?.acquisitionStates?.[name] : null
    return {
      id: active ? String(active.id ?? active.createTime ?? '') : null,
      index: active?.index ?? null,
      finished: active?.isFinished === true,
      current: active?.words?.[active?.index]?.name ?? null,
      phase: state?.phase ?? null,
      cycles: state?.assistedCycles ?? 0,
      deferredReason: state?.deferredReason ?? null,
      resumeAfter: state?.resumeAfter ?? null,
    }
  }, tracked)
}

async function persisted(page: Page, word: string, id: string) {
  return page.evaluate(({ word, id }) => new Promise<{
    attempts: number; admitted: boolean; phase: string | null;
    reason: string | null; resumeAfter: number | null;
  }>((resolve, reject) => {
    const open = indexedDB.open('RecordDB')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(['wordRecords','reviewRecords','reviewWordStates'],'readonly')
      const history = tx.objectStore('wordRecords').getAll()
      const sessions = tx.objectStore('reviewRecords').getAll()
      const states = tx.objectStore('reviewWordStates').getAll()
      tx.onerror = () => reject(tx.error)
      tx.oncomplete = () => {
        const snapshot = sessions.result.find((row: { id?: number; createTime?: number }) =>
          String(row.id ?? row.createTime ?? '') === id)
        const state = snapshot?.acquisitionStates?.[word]
        resolve({
          attempts: history.result.filter((r: { word?: string; sourceMode?: string }) =>
            r.word === word && r.sourceMode === 'learn').length,
          admitted: states.result.some((r: { word?: string; lifecycle?: string }) =>
            r.word === word && r.lifecycle === 'active'),
          phase: state?.phase ?? null,
          reason: state?.deferredReason ?? null,
          resumeAfter: state?.resumeAfter ?? null,
        })
        db.close()
      }
    }
  }), { word, id })
}

async function activeLearn(page: Page) {
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

test('Explorer V3: two independent ESC failures defer acquisition, resume after five virtual minutes', async ({
  page, request,
}) => {
  test.setTimeout(230_000)
  expect(sha).toMatch(/^[0-9a-f]{40}$/)
  await expect.poll(async () => {
    const r = await request.get(site + 'source-commit.txt', { failOnStatusCode: false })
    return r.ok() ? (await r.text()).trim() : ''
  }, { intervals: [1000, 2000, 5000], timeout: 90_000 }).toBe(sha)

  const steps: Array<{
    step: number; action: string; phase: string | null;
    cycles: number; attempts: number; sessionFinished: boolean;
  }> = []
  const failures: string[] = []
  const cloudCalls: string[] = []
  page.on('pageerror', e => failures.push(e.message))
  page.on('request', r => {
    if (/^\/api\/(auth|sync)(\/|$)/.test(new URL(r.url()).pathname)) {
      cloudCalls.push(new URL(r.url()).pathname)
    }
  })

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
    await activeLearn(page)

    const wordNode = page.locator('[data-typing-word]:visible').first()
    await expect(wordNode).toHaveAttribute('data-typing-word', /\S+/)
    const target = await wordNode.getAttribute('data-typing-word')
    if (!target) throw new Error('initial Learn target unavailable')
    const initial = await session(page, target)
    expect(initial.phase).toBe('exposure')
    expect(initial.id).toBeTruthy()
    const id = initial.id!

    let independentFailures = 0
    let deferred: SessionView | null = null
    let lastHistory = 0
    for (let i = 0; i < 100; i++) {
      const before = await session(page, target)
      expect(before.id).toBe(id)
      if (before.finished) break
      await activeLearn(page)
      const node = page.locator('[data-typing-word]:visible').first()
      await expect(node).toHaveAttribute('data-typing-word', /\S+/)
      const spelling = await node.getAttribute('data-typing-word')
      if (!spelling) throw new Error('active word disappeared')
      const tracked = spelling === target
      const current = await session(page, target)
      const attemptPhase = tracked ? current.phase : null
      const surrender = tracked && attemptPhase === 'independent' &&
        independentFailures < 2
      if (surrender) {
        await page.keyboard.press('Escape')
        await expect(node).toHaveAttribute('data-review-hint-level', '3')
        independentFailures++
      }
      // Word completion is real keyboard input; no fake persisted state.
      await page.keyboard.type(spelling)
      await expect.poll(async () => {
        const data = await persisted(page, target, id)
        const other = await page.evaluate(() => new Promise<number>((resolve, reject) => {
          const op = indexedDB.open('RecordDB')
          op.onerror = () => reject(op.error)
          op.onsuccess = () => {
            const db = op.result
            const tx = db.transaction('wordRecords', 'readonly')
            const query = tx.objectStore('wordRecords').count()
            query.onsuccess = () => { resolve(query.result); db.close() }
            query.onerror = () => reject(query.error)
          }
        }))
        return other > lastHistory ? other : 0
      }, { timeout: 20_000 }).toBeGreaterThan(0)

      // The localStorage cursor may settle just after the durable record.
      await expect.poll(async () => {
        const value = await session(page, target)
        return value.index !== before.index || value.finished ||
          value.phase !== before.phase
      }, { timeout: 20_000 }).toBe(true)
      const after = await session(page, target)
      const total = await page.evaluate(() => new Promise<number>((resolve,reject) => {
        const req = indexedDB.open('RecordDB')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('wordRecords','readonly')
          const count = tx.objectStore('wordRecords').count()
          count.onsuccess = () => { resolve(count.result); db.close() }
          count.onerror = () => reject(count.error)
        }
      }))
      expect(total).toBe(lastHistory + 1)
      lastHistory = total
      steps.push({
        step: i, action: surrender ? 'independent-escape' : 'clean-complete',
        phase: after.phase, cycles: after.cycles, attempts: total,
        sessionFinished: after.finished,
      })
      if (after.phase === 'deferred' && after.deferredReason === 'assistance') {
        deferred = after
        expect(independentFailures).toBe(2)
      }
      if (after.finished) break
    }
    expect(independentFailures, 'must exercise two actual independent surrenders').toBe(2)
    expect(deferred, 'target must enter genuine assistance Deferred').not.toBeNull()
    expect(deferred!.resumeAfter).toBeGreaterThan(0)
    const completion = await session(page, target)
    expect(completion.finished, 'first Block must settle before idle clock jump').toBe(true)
    await expect.poll(async () => {
      const saved = await persisted(page, target, id)
      return {
        phase: saved.phase, reason: saved.reason,
        resumeAfter: saved.resumeAfter, admitted: saved.admitted,
      }
    }, { timeout: 20_000 }).toEqual({
      phase: 'deferred', reason: 'assistance',
      resumeAfter: deferred!.resumeAfter, admitted: false,
    })

    const result = page.locator('[data-learn-result-screen]')
    await expect(result).toBeVisible()
    await expect(result.getByText('正在保存本阶段学习状态…')).toBeHidden()
    await result.getByRole('button', { name: '暂停 Learn' }).click()
    await expect(result).toHaveCount(0)

    // Virtual time is installed only after leaving the active spelling
    // engine. It never changes a user's native key/animation timings.
    await installExplorerBusinessClock(page, Date.now())
    await page.goto(site + 'typing', { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/按任意键(?:开始|继续)/).first()).toBeVisible()

    const remaining = deferred!.resumeAfter! - Math.floor(Date.now() / 1000)
    expect(remaining, 'defer cooling period elapsed before time warp').toBeGreaterThan(5)
    // Explicit pre-deadline observation: at t=resumeAfter-2 the real
    // durable session must still be Deferred, without scheduler admission.
    await advanceIdleBusinessTime(page, remaining - 2)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const premature = await persisted(page, target, id)
    expect(premature.phase).toBe('deferred')
    expect(premature.admitted).toBe(false)
    expect(Math.floor(await page.evaluate(() => Date.now() / 1000)))
      .toBeLessThan(deferred!.resumeAfter!)
    steps.push({
      step: steps.length, action: 'pre-deadline-still-deferred',
      phase: premature.phase, cycles: 2, attempts: lastHistory,
      sessionFinished: true,
    })
    // Use the idle-only virtual clock: only the time axis changes.
    await advanceIdleBusinessTime(page, 4)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    await activeLearn(page)
    const resumed = await session(page, target)
    expect(resumed.id).not.toBe(id)
    expect(resumed.phase, 'cooled Deferred target must return to Supported').toBe('supported')
    expect(resumed.cycles).toBe(2)
    expect(resumed.deferredReason).toBeNull()
    expect(resumed.resumeAfter).toBeNull()
    const prior = await persisted(page, target, id)
    expect(prior.admitted).toBe(false)
    steps.push({
      step: steps.length, action: 'cooled-re-entry-supported', phase: resumed.phase,
      cycles: resumed.cycles, attempts: lastHistory, sessionFinished: resumed.finished,
    })
    expect(cloudCalls).toEqual([])
    expect(failures).toEqual([])
  } finally {
    const path = test.info().outputPath('pages-deferred-v3-redacted.json')
    writeFileSync(path, JSON.stringify({
      schema: 'pages-deferred-v3-v1', publishedSha: sha,
      completedSteps: steps.length, steps,
      pageErrorCount: failures.length, cloudCallCount: cloudCalls.length,
    }, null, 2))
    await test.info().attach('pages-deferred-v3-redacted.json', {
      path, contentType: 'application/json',
    })
  }
})
