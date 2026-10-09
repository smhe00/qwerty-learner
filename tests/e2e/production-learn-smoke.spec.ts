import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Published-site smoke: no signup, no synthetic DB injection, no cloud writes.
// Each test runs in a fresh isolated incognito browser context. The actual
// served JS and IndexedDB are exercised through user-visible keyboard input.
const origin = process.env.QWERTY_SYNC_BASE_URL
if (!origin || new URL(origin).origin !== 'https://qwerty-plus.edgeone.dev') {
  throw new Error('Refusing live Learn smoke outside the designated production origin')
}

async function learnCursor(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('reviewModeInfo')
    const info = raw ? JSON.parse(raw) : null
    return info?.reviewRecord?.index ?? null
  })
}

async function recordCount(page: Page, target: string): Promise<number> {
  return page.evaluate(async (word) => {
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('wordRecords', 'readonly')
        const rows = tx.objectStore('wordRecords').getAll()
        rows.onerror = () => reject(rows.error)
        rows.onsuccess = () => {
          resolve(rows.result.filter((row: { word?: string; sourceMode?: string }) =>
            row.word === word && row.sourceMode === 'learn').length)
          db.close()
        }
      }
    })
  }, target)
}

test('live Learn: one real typed word is durable after browser refresh', async ({ page }) => {
  test.setTimeout(100_000)
  const checkpoints: Array<{ event: string; cursor: number | null; records: number }> = []
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  try {
    await page.goto(new URL('/learn', origin).toString(), { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('按任意键开始')).toBeVisible({ timeout: 25_000 })
    const wordLocator = page.locator('[data-typing-word]:visible').first()
    await expect(wordLocator).toHaveAttribute('data-typing-word', /\S+/)
    const word = await wordLocator.getAttribute('data-typing-word')
    expect(word).toBeTruthy()
    expect(await learnCursor(page)).toBe(0)
    checkpoints.push({ event: 'learn-ready', cursor: 0, records: 0 })

    await page.keyboard.press('a') // start key is not a spelling character
    await page.keyboard.type(word as string)
    await expect.poll(() => learnCursor(page), { timeout: 20_000 }).toBe(1)
    await expect.poll(() => recordCount(page, word as string), { timeout: 20_000 }).toBe(1)
    checkpoints.push({ event: 'first-keyboard-word-committed', cursor: 1, records: 1 })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => learnCursor(page), { timeout: 20_000 }).toBe(1)
    await expect.poll(() => recordCount(page, word as string), { timeout: 20_000 }).toBe(1)
    checkpoints.push({ event: 'refresh-retains-progress', cursor: 1, records: 1 })
    expect(errors).toEqual([])
  } finally {
    // Do not attach word strings, IndexedDB snapshots, auth, tokens or URLs
    // containing credentials to CI reports.
    const filename = test.info().outputPath('published-learn-redacted-checkpoints.json')
    mkdirSync(dirname(filename), { recursive: true })
    writeFileSync(filename, JSON.stringify({ schema: 'published-learn-smoke-v1', checkpoints }, null, 2))
    await test.info().attach('published-learn-redacted-checkpoints.json', {
      path: filename,
      contentType: 'application/json',
    })
  }
})

test('live Learn: repeated reload cannot grow route or add tilde-and fragments', async ({ page }) => {
  test.setTimeout(80_000)
  const entry = new URL('/learn/', origin).toString()
  await page.goto(entry, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 20_000 })

  const canonical = new URL(page.url())
  expect(canonical.pathname).toMatch(/^\/learn\/?$/)
  expect(canonical.search).not.toContain('~and~')
  expect(canonical.search).not.toContain('?/&/')

  for (let attempt = 0; attempt < 4; attempt++) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 20_000 })
    const current = new URL(page.url())
    expect(current.pathname, 'reload changed Learn pathname').toBe(canonical.pathname)
    expect(current.search, 'reload appended route query fragments').toBe(canonical.search)
    expect(current.href).not.toContain('~and~')
  }
})
