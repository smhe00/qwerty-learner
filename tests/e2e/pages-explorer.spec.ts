import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const site = 'https://smhe00.github.io/qwerty-learner/'
const seed = Number(process.env.EXPLORER_SEED || 20261009)
function nextRandom(s: number): () => number {
  let state = s >>> 0
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296)
}

test('isolated Pages exploration: route and refresh transitions', async ({ page, request }) => {
  test.setTimeout(150_000)
  const random = nextRandom(seed)
  const trace: Array<{ step: number; action: string; route: string }> = []
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const sha = process.env.PAGES_SOURCE_SHA
  expect(sha).toMatch(/^[0-9a-f]{40}$/)
  const published = await request.get(site + 'source-commit.txt')
  expect((await published.text()).trim()).toBe(sha)
  try {
    await page.goto(site, { waitUntil: 'domcontentloaded' })
    for (let step = 0; step < 18; step++) {
      const action = random() < 0.4 ? 'reload' : random() < 0.5 ? 'learn' : 'home'
      if (action === 'reload') await page.reload({ waitUntil: 'domcontentloaded' })
      else if (action === 'learn') await page.getByRole('button', { name: 'Learn', exact: true }).click()
      else await page.goto(site, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
      const path = new URL(page.url()).pathname
      expect(path).toMatch(/^\/qwerty-learner\/(?:learn\/?)?$/)
      expect(page.url()).not.toContain('~and~')
      trace.push({ step, action, route: path })
    }
    expect(errors).toEqual([])
  } finally {
    // No word content, account, credentials or browser storage in attachments.
    const path = test.info().outputPath('pages-explorer-trace.json')
    writeFileSync(path, JSON.stringify({ seed, sha, trace, errorCount: errors.length }, null, 2))
    await test.info().attach('pages-explorer-trace.json', { path, contentType: 'application/json' })
  }
})

/**
 * Advisory real-UI stress path: ESC hint/surrender, corrective typing and
 * reload. The trace deliberately excludes word spellings and browser storage.
 * Failures retain a reproducible seed without blocking the fixed regression.
 */
test('isolated Pages exploration: ESC hint and corrective Learn completion', async ({ page, request }) => {
  test.setTimeout(120_000)
  const sha = process.env.PAGES_SOURCE_SHA
  expect(sha).toMatch(/^[0-9a-f]{40}$/)
  const response = await request.get(site + 'source-commit.txt')
  expect((await response.text()).trim()).toBe(sha)
  const checkpoints: Array<{ action: string; index: number | null; finished: boolean; hint?: string | null }> = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  async function progress() {
    return page.evaluate(() => {
      const raw = localStorage.getItem('reviewModeInfo')
      const record = raw ? JSON.parse(raw).reviewRecord : null
      return { index: record?.index ?? null, finished: record?.isFinished === true }
    })
  }
  try {
    await page.goto(site, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    await expect(page.getByText('按任意键开始')).toBeVisible()
    const activeWord = page.locator('[data-typing-word]:visible').first()
    await expect(activeWord).toHaveAttribute('data-typing-word', /\S+/)
    const word = await activeWord.getAttribute('data-typing-word')
    expect(word).toBeTruthy()
    await page.keyboard.press('a')
    checkpoints.push({ action: 'start', ...await progress() })
    await page.keyboard.press('Escape')
    await expect(activeWord).toHaveAttribute('data-review-hint-level', '3')
    checkpoints.push({
      action: 'escape-full-hint',
      ...await progress(),
      hint: await activeWord.getAttribute('data-review-hint-stage'),
    })
    await page.keyboard.type(word!)
    await expect.poll(async () => {
      const state = await progress()
      return state.finished || (state.index !== null && state.index > 0)
    }, { timeout: 20_000 }).toBe(true)
    const saved = await progress()
    checkpoints.push({ action: 'corrective-complete', ...saved })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
    await expect.poll(() => progress()).toEqual(saved)
    checkpoints.push({ action: 'durable-reload', ...await progress() })
    expect(errors).toEqual([])
  } finally {
    const path = test.info().outputPath('pages-escape-replay.json')
    writeFileSync(path, JSON.stringify({ schema: 'pages-escape-v1', seed, sha, checkpoints, pageErrorCount: errors.length }, null, 2))
    await test.info().attach('pages-escape-replay.json', { path, contentType: 'application/json' })
  }
})
