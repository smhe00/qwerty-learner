import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'

// Published-site, browser-isolated exploration. No synthetic workspace
// state, test accounts, tokens, cloud writes or raw dictionary data.
const site = 'https://smhe00.github.io/qwerty-learner/'
const seed = Number(process.env.EXPLORER_SEED || '20261010') >>> 0
const budget = Math.max(3, Math.min(32, Number(process.env.EXPLORER_WORD_BUDGET || '8') || 8))
const seedCount = Math.max(1, Math.min(5, Number(process.env.EXPLORER_SEED_COUNT || '3') || 3))
const sha = process.env.PAGES_SOURCE_SHA

type Snapshot = {
  cursor: number | null
  finished: boolean
  recordCount: number
  reviewStateCount: number
  durableCursor: number | null
  durableFinished: boolean | null
  sessionId: string | null // internal comparison only; never attached
}
type TraceEntry = {
  step: number
  action: string
  cursor: number | null
  records: number
  fsrsStates: number
  letters?: string | null
  phase?: string | null
  hint?: string | null
  route: 'learn' | 'typing' | 'other'
}

function generator(value: number) {
  let state = value >>> 0
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296)
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const raw = localStorage.getItem('reviewModeInfo')
    const session = raw ? JSON.parse(raw).reviewRecord : null
    const sessionId = session ? String(session.id ?? session.createTime ?? '') : null
    const data = await new Promise<{
      count: number
      states: number
      cursor: number | null
      finished: boolean | null
    }>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['wordRecords', 'reviewRecords', 'reviewWordStates'], 'readonly')
        const records = tx.objectStore('wordRecords').getAll()
        const sessions = tx.objectStore('reviewRecords').getAll()
        const states = tx.objectStore('reviewWordStates').count()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
        tx.oncomplete = () => {
          const matching = sessions.result.find((row: { id?: number; createTime?: number }) =>
            String(row.id ?? row.createTime ?? '') === sessionId)
          resolve({
            count: records.result.filter((row: { sourceMode?: string }) => row.sourceMode === 'learn').length,
            states: states.result,
            cursor: matching?.index ?? null,
            finished: matching?.isFinished ?? null,
          })
          db.close()
        }
      }
    })
    return {
      cursor: session?.index ?? null,
      finished: session?.isFinished === true,
      recordCount: data.count,
      reviewStateCount: data.states,
      durableCursor: data.cursor,
      durableFinished: data.finished,
      sessionId,
    }
  })
}

function routeName(page: Page): TraceEntry['route'] {
  const path = new URL(page.url()).pathname
  if (/\/learn\/?$/.test(path)) return 'learn'
  if (/\/typing\/?$/.test(path)) return 'typing'
  return 'other'
}

async function assertCanonical(page: Page) {
  const current = new URL(page.url())
  expect(current.origin).toBe('https://smhe00.github.io')
  expect(current.pathname).toMatch(/^\/qwerty-learner\/(?:learn|typing)?\/?$/)
  expect(current.search).not.toContain('~and~')
  expect(current.href).not.toContain('?/&/')
}

async function ensureActiveLearn(page: Page) {
  await expect(page).toHaveURL(/\/qwerty-learner\/learn\/?$/, { timeout: 20_000 })
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  const pending = page.getByText(/按任意键(?:开始|继续)/).first()
  if (await pending.isVisible().catch(() => false)) {
    await page.keyboard.press('a')
    await expect(pending).toBeHidden()
  }
  await expect.poll(async () => {
    const word = page.locator('[data-typing-word]:visible').first()
    if (!(await word.isVisible().catch(() => false))) return 'missing'
    if (await word.getAttribute('data-typing-locked') === 'true') return 'locked'
    if (await word.getAttribute('data-typing-finished') === 'true') return 'finished'
    return 'ready'
  }, { timeout: 20_000 }).toBe('ready')
}

for (let trial = 0; trial < seedCount; trial++) {
const caseSeed = (seed + trial * 1009) >>> 0
test(`coverage-guided Pages Learn seed ${caseSeed}: keyboard, hint, resume, IndexedDB, mode-switch and reload`, async ({
  page, request,
}) => {
  test.setTimeout(240_000)
  expect(sha).toMatch(/^[a-f0-9]{40}$/)
  await expect.poll(async () => {
    const response = await request.get(site + 'source-commit.txt', { failOnStatusCode: false })
    return response.ok() ? (await response.text()).trim() : ''
  }, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toBe(sha)

  const rand = generator(caseSeed)
  const trace: TraceEntry[] = []
  const coverage = new Set<string>()
  const pageErrors: string[] = []
  const cloudRequests: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => {
    const uri = new URL(request.url())
    if (/^\/api\/(?:auth|sync)(?:\/|$)/.test(uri.pathname)) cloudRequests.push(uri.pathname)
  })

  function record(step: number, action: string, state: Snapshot, attributes?: {
    letters?: string | null; phase?: string | null; hint?: string | null
  }) {
    // sessionId and word strings are deliberately excluded.
    trace.push({
      step, action, cursor: state.cursor, records: state.recordCount,
      fsrsStates: state.reviewStateCount, ...attributes, route: routeName(page),
    })
    coverage.add(action)
    if (attributes?.phase) coverage.add('phase:' + attributes.phase)
    if (attributes?.letters) coverage.add('letters:' + attributes.letters)
  }

  async function invariant(expected: Snapshot) {
    const after = await snapshot(page)
    expect(after.sessionId).toBe(expected.sessionId)
    expect(after.cursor).toBe(expected.cursor)
    expect(after.finished).toBe(expected.finished)
    expect(after.recordCount).toBe(expected.recordCount)
    expect(after.reviewStateCount).toBe(expected.reviewStateCount)
    expect(after.durableCursor).toBe(expected.durableCursor)
    expect(after.durableFinished).toBe(expected.durableFinished)
    await assertCanonical(page)
  }

  try {
    await page.goto(site, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    await ensureActiveLearn(page)
    let start = await snapshot(page)
    expect(start.cursor).not.toBeNull()
    expect(start.sessionId).toBeTruthy()
    record(0, 'start-learn', start)

    for (let i = 0; i < budget; i++) {
      await ensureActiveLearn(page)
      const wordNode = page.locator('[data-typing-word]:visible').first()
      await expect(wordNode).toHaveAttribute('data-typing-word', /\S+/)
      const word = await wordNode.getAttribute('data-typing-word')
      expect(word).toBeTruthy()
      const letters = await wordNode.getAttribute('data-review-letters')
      const phaseNode = page.locator('[data-learn-acquisition-phase]:visible').first()
      const phase = await phaseNode.count()
        ? await phaseNode.getAttribute('data-learn-acquisition-phase')
        : null
      const before = await snapshot(page)
      expect(before.finished).toBe(false)
      expect(before.sessionId).toBe(start.sessionId)
      expect(before.cursor).toBeGreaterThanOrEqual(start.cursor!)
      expect(before.recordCount).toBeGreaterThanOrEqual(start.recordCount)

      // Observe the actual exercise condition before choosing legal actions.
      // Exposure is already a visible copy; ESC intentionally does not
      // activate its hint machine. Recall/probe does support ESC surrender.
      if (letters !== 'all-visible' && !coverage.has('wrong-attempt') &&
          word && /^[a-zA-Z]{4,}$/.test(word)) {
        // Exercise the real wrong-key -> assisted-retry transition exactly
        // once, only when the current exercise has a managed hint machine.
        const mismatch = word[2].toLowerCase() === 'x' ? 'z' : 'x'
        await page.keyboard.type(word.slice(0, 2) + mismatch)
        await expect.poll(() => wordNode.getAttribute('data-typing-input'),
          { timeout: 10_000 }).toBe('')
        coverage.add('wrong-attempt')
        record(i, 'wrong-attempt-reset', await snapshot(page), {
          letters, phase, hint: await wordNode.getAttribute('data-review-hint-stage'),
        })
      }
      if (i === 0 || (letters !== 'all-visible' && rand() < 0.7)) {
        await page.keyboard.press('Escape')
        if (letters === 'all-visible') {
          await expect(wordNode).toHaveAttribute('data-review-letters', 'all-visible')
          coverage.add('exposure-escape-no-hint')
        } else {
          await expect(wordNode).toHaveAttribute('data-review-hint-level', '3')
          coverage.add('managed-escape-full-hint')
        }
        record(i, 'escape', before, {
          phase, letters, hint: await wordNode.getAttribute('data-review-hint-stage'),
        })
      }

      await page.keyboard.type(word!)
      await expect.poll(async () => {
        const state = await snapshot(page)
        return (state.cursor !== null && state.cursor > before.cursor!) ||
          state.finished ? state.recordCount > before.recordCount : false
      }, { timeout: 20_000 }).toBe(true)

      await expect.poll(async () => {
        const state = await snapshot(page)
        return state.durableCursor === state.cursor &&
          state.durableFinished === state.finished
      }, { timeout: 20_000 }).toBe(true)
      const committed = await snapshot(page)
      expect(committed.recordCount).toBe(before.recordCount + 1)
      expect(committed.cursor).toBeGreaterThanOrEqual(before.cursor!)
      record(i, 'word-committed', committed, { letters, phase })
      coverage.add('indexeddb-durable')

      // Exercise suspension/re-entry without replaying the completed word.
      if (i === 0 || (i > 1 && rand() < 0.35)) {
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
        await expect.poll(() => snapshot(page), { timeout: 20_000 }).toEqual(committed)
        await invariant(committed)
        record(i, 'reload-idempotent', await snapshot(page))
      } else if (i === 1 || (i > 2 && rand() < 0.22)) {
        await page.getByRole('button', { name: 'Typing', exact: true }).click()
        await expect(page).toHaveURL(/\/typing\/?$/)
        await assertCanonical(page)
        record(i, 'switch-typing', await snapshot(page))
        await page.getByRole('button', { name: 'Learn', exact: true }).click()
        await expect(page).toHaveURL(/\/learn\/?$/)
        await expect.poll(async () => {
          const resumed = await snapshot(page)
          return resumed.cursor === committed.cursor &&
            resumed.recordCount === committed.recordCount
        }, { timeout: 20_000 }).toBe(true)
        record(i, 'switch-learn-resume', await snapshot(page))
      }
      start = await snapshot(page)
      if (committed.finished) {
        record(i, 'block-finished', committed)
        break
      }
    }

    // Coverage threshold intentionally concerns available user actions;
    // a fixed dictionary may not offer a managed recall phase in a short run.
    expect(coverage.has('indexeddb-durable')).toBe(true)
    expect(coverage.has('reload-idempotent')).toBe(true)
    expect(coverage.has('switch-typing')).toBe(true)
    expect(trace.filter(t => t.action === 'word-committed').length)
      .toBeGreaterThanOrEqual(3)
    expect(pageErrors, 'browser runtime errors').toEqual([])
    expect(cloudRequests, 'Pages must not contact auth/sync APIs').toEqual([])
  } finally {
    console.log('[Pages Explorer coverage]', JSON.stringify({
      seed: caseSeed, wordBudget: budget,
      completedWords: trace.filter(item => item.action === 'word-committed').length,
      coverage: [...coverage].sort(),
      pageErrorCount: pageErrors.length, cloudRequestCount: cloudRequests.length,
    }))
    const filename = test.info().outputPath('pages-stateful-explorer-redacted.json')
    writeFileSync(filename, JSON.stringify({
      schema: 'pages-stateful-explorer-v1',
      publishedSha: sha,
      seed: caseSeed, wordBudget: budget,
      coverage: [...coverage].sort(),
      trace,
      pageErrorCount: pageErrors.length,
      cloudRequestCount: cloudRequests.length,
    }, null, 2))
    await test.info().attach('pages-stateful-explorer-redacted.json', {
      path: filename, contentType: 'application/json',
    })
  }
})
}
