import { expect, test } from '@playwright/test'

const site = 'https://smhe00.github.io/qwerty-learner/'
const targetSha = process.env.PAGES_SOURCE_SHA
if (!targetSha || !/^[a-f0-9]{40}$/.test(targetSha)) throw new Error('Missing verified Pages source SHA')

test('published Pages: matching SHA, cloud disabled, Learn route and reload durability', async ({ page, request }) => {
  test.setTimeout(120_000)
  await expect.poll(async () => {
    const result = await request.get(site + 'source-commit.txt', { failOnStatusCode: false })
    return result.ok() ? (await result.text()).trim() : ''
  }, { timeout: 90000, intervals: [1000, 2000, 5000] }).toBe(targetSha)
  await page.goto(site, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/qwerty-learner\/learn\/?$/)
  const original = new URL(page.url())
  for (let step = 0; step < 4; step++) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(original.pathname)
    expect(new URL(page.url()).search).toBe(original.search)
    expect(page.url()).not.toContain('~and~')
  }
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
  // P1 removes the entire cloud account/sync section in Pages builds.
  // Verify local backup remains available and cloud actions are absent.
  await expect(page.getByText('本地备份', { exact: true })).toBeVisible()
  await expect(page.getByText('云端同步与账号', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0)
})

/**
 * Published-site keyboard smoke. Unlike the deterministic localhost Review
 * fixtures, this uses the actual public dictionary and a fresh browser
 * context. It does not create cloud identities or write synthetic records.
 */
test('published Pages: real Learn keystrokes produce one durable record across refresh', async ({ page, request }) => {
  test.setTimeout(120_000)
  await expect.poll(async () => {
    const response = await request.get(site + 'source-commit.txt', { failOnStatusCode: false })
    return response.ok() ? (await response.text()).trim() : ''
  }, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toBe(targetSha)

  const pageErrors: string[] = []
  const cloudCalls: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (/^\/api\/(auth|sync)(?:\/|$)/.test(path)) cloudCalls.push(path)
  })

  async function progress() {
    return page.evaluate(() => {
      const raw = localStorage.getItem('reviewModeInfo')
      const session = raw ? JSON.parse(raw).reviewRecord : null
      return { index: session?.index ?? null, finished: session?.isFinished === true }
    })
  }
  async function committedRecords(word: string) {
    return page.evaluate((name) => new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('wordRecords', 'readonly')
        const rows = tx.objectStore('wordRecords').getAll()
        rows.onerror = () => reject(rows.error)
        rows.onsuccess = () => {
          resolve(rows.result.filter((record: { word?: string; sourceMode?: string }) =>
            record.word === name && record.sourceMode === 'learn').length)
          db.close()
        }
      }
    }), word)
  }

  await page.goto(site, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/qwerty-learner\/learn\/?$/)
  await expect(page.getByText('按任意键开始')).toBeVisible()
  const wordNode = page.locator('[data-typing-word]:visible').first()
  await expect(wordNode).toHaveAttribute('data-typing-word', /\S+/)
  const word = await wordNode.getAttribute('data-typing-word')
  expect(word).toBeTruthy()

  await page.keyboard.press('a') // start key is not part of the spelling
  await page.keyboard.type(word!)
  await expect.poll(async () => {
    const state = await progress()
    return state.finished || (state.index !== null && state.index > 0)
  }, { timeout: 20_000 }).toBe(true)
  await expect.poll(() => committedRecords(word!), { timeout: 20_000 }).toBe(1)

  const beforeReload = await progress()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await expect.poll(() => progress()).toEqual(beforeReload)
  await expect.poll(() => committedRecords(word!)).toBe(1)
  expect(page.url()).not.toContain('~and~')
  expect(pageErrors).toEqual([])
  expect(cloudCalls).toEqual([])
})

test('published Pages: Typing uses real key input and advances independently', async ({ page, request }) => {
  test.setTimeout(90_000)
  await expect.poll(async () => {
    const response = await request.get(site + 'source-commit.txt', { failOnStatusCode: false })
    return response.ok() ? (await response.text()).trim() : ''
  }, { timeout: 60_000, intervals: [1000, 2000, 5000] }).toBe(targetSha)

  await page.goto(site, { waitUntil: 'domcontentloaded' })
  const typing = page.getByRole('button', { name: 'Typing', exact: true })
  await expect(typing).toBeVisible()
  await typing.click()
  const activeWord = page.locator('[data-typing-word]:visible').first()
  await expect(activeWord).toHaveAttribute('data-typing-word', /\S+/)
  const initial = await activeWord.getAttribute('data-typing-word')
  expect(initial).toBeTruthy()
  await page.keyboard.press('a')
  await page.keyboard.type(initial!)
  await expect.poll(() => activeWord.getAttribute('data-typing-word'), { timeout: 20_000 }).not.toBe(initial)
  await expect(page.getByRole('button', { name: 'Typing', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
