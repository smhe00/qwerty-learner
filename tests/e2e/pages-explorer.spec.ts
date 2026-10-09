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
