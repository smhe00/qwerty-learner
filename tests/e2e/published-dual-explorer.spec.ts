import { expect, test, type Page, type APIRequestContext } from '@playwright/test'
import { writeFileSync } from 'node:fs'

/**
 * Published dual-site Explorer. Tests actual Pages/EdgeOne served assets,
 * not the local source checkout. Browser contexts have no account/session
 * state; no cloud mutation, signup or user-data access is allowed.
 */
const target = process.env.PUBLISHED_EXPLORER_TARGET
if (target !== 'pages' && target !== 'edgeone') {
  throw new Error('PUBLISHED_EXPLORER_TARGET must be pages or edgeone')
}
const site = target === 'pages'
  ? 'https://smhe00.github.io/qwerty-learner/'
  : 'https://qwerty-plus.edgeone.dev/'
const base = new URL(site)
const expectedSha = process.env.PAGES_SOURCE_SHA
const seed = Number(process.env.PUBLISHED_EXPLORER_SEED || 20261010)
const basePath = target === 'pages' ? '/qwerty-learner/' : '/'
const routePath = (route: string) => basePath + route
const fullUrl = (route: string) => new URL(routePath(route), base).href

function random(seedValue: number) {
  let state = seedValue >>> 0
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 0x100000000)
}

type Checkpoint = { phase: string; cursor?: number | null; records?: number; pathname?: string }

async function baseline(request: APIRequestContext) {
  if (target === 'pages') {
    expect(expectedSha, 'Pages run must pin deployed immutable source SHA')
      .toMatch(/^[0-9a-f]{40}$/)
    await expect.poll(async () => {
      const response = await request.get(fullUrl('source-commit.txt'), {
        failOnStatusCode: false,
      })
      return response.ok() ? (await response.text()).trim() : ''
    }, { timeout: 180_000, intervals: [1000, 3000, 5000] }).toBe(expectedSha)
  } else {
    const health = await request.get(fullUrl('api/health'), { timeout: 20_000 })
    expect(health.status()).toBe(200)
    const status = await health.json()
    expect(status.ok).toBe(true)
    expect(status.service).toBe('qwerty-sync-gateway')
  }
}

function track(page: Page) {
  const browserErrors: string[] = []
  const illegalCloudWrites: string[] = []
  page.on('pageerror', e => browserErrors.push(e.message))
  page.on('request', req => {
    const url = new URL(req.url())
    if (url.origin === base.origin && url.pathname.startsWith('/api/') &&
      req.method() !== 'GET' && req.method() !== 'HEAD' &&
      req.method() !== 'OPTIONS') illegalCloudWrites.push(url.pathname)
  })
  return { browserErrors, illegalCloudWrites }
}

function checkUrl(url: string, expectedRoute: 'learn' | 'typing' | 'analysis') {
  const actual = new URL(url)
  expect(actual.origin).toBe(base.origin)
  expect(actual.pathname).toBe(routePath(expectedRoute))
  expect(actual.href).not.toContain('~and~')
  expect(actual.href).not.toContain('?/&/')
}

async function progress(page: Page, word: string | null = null) {
  return page.evaluate(async (needle) => {
    const raw = localStorage.getItem('reviewModeInfo')
    const session = raw ? JSON.parse(raw).reviewRecord : undefined
    const dbRequest = indexedDB.open('RecordDB')
    const recordCount = await new Promise<number>((resolve, reject) => {
      dbRequest.onerror = () => reject(dbRequest.error)
      dbRequest.onsuccess = () => {
        const db = dbRequest.result
        const tx = db.transaction('wordRecords', 'readonly')
        const all = tx.objectStore('wordRecords').getAll()
        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => {
          const rows = all.result
          resolve(rows.filter((r: { sourceMode?: string; word?: string }) =>
            r.sourceMode === 'learn' && (needle === null || r.word === needle)).length)
          db.close()
        }
      }
    })
    return {
      id: session ? String(session.id ?? session.createTime ?? '') : null,
      cursor: session?.index ?? null,
      finished: session?.isFinished === true,
      records: recordCount,
    }
  }, word)
}

test('dual-site: service boundary, dictionary, analysis and data-settings contract', async ({ page, request }) => {
  test.setTimeout(240_000)
  const observed = track(page)
  await baseline(request)
  await page.goto(site, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await expect(page.getByRole('link', { name: '上海中考2027', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
  await expect(page.getByText('本地备份', { exact: true })).toBeVisible()
  if (target === 'pages') {
    await expect(page.getByText('云端同步与账号', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0)
  } else {
    await expect(page.getByText('云端同步与账号', { exact: true })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.goto(fullUrl('analysis?from=learn'), { waitUntil: 'domcontentloaded' })
  checkUrl(page.url().split('?')[0], 'analysis')
  await expect(page.locator('[data-fsrs-shadow-analysis]')).toBeVisible()
  await page.goto(fullUrl('typing'), { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-typing-word]:visible').first())
    .toHaveAttribute('data-typing-word', /\S+/)
  checkUrl(page.url(), 'typing')
  expect(observed.browserErrors).toEqual([])
  expect(observed.illegalCloudWrites).toEqual([])
})

test('dual-site: real Learn typing, two durable commits, reload and Typing/Learn restoration', async ({
  page, request,
}) => {
  test.setTimeout(210_000)
  const observed = track(page)
  await baseline(request)
  const checkpoints: Checkpoint[] = []
  try {
    await page.goto(site, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(routePath('learn').replaceAll('/', '\\/') + '\\/?$'))
    const prompt = page.getByText(/按任意键(?:开始|继续)/).first()
    await expect(prompt).toBeVisible({ timeout: 25_000 })
    const first = await progress(page)
    expect(first.id).toBeTruthy()
    expect(first.cursor).toBe(0)
    checkpoints.push({ phase: 'ready', cursor: first.cursor, records: first.records })

    await page.keyboard.press('a')
    await expect(prompt).toBeHidden()
    for (let number = 1; number <= 2; number++) {
      const current = page.locator('[data-typing-word]:visible').first()
      await expect(current).toHaveAttribute('data-typing-word', /\S+/)
      const word = await current.getAttribute('data-typing-word')
      expect(word).toBeTruthy()
      await page.keyboard.type(word!)
      await expect.poll(async () => {
        const s = await progress(page)
        return s.cursor === number && s.records === number
      }, { timeout: 20_000 }).toBe(true)
      const s = await progress(page)
      checkpoints.push({ phase: 'real-keyboard-' + number, cursor: s.cursor, records: s.records })
    }
    const before = await progress(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
    await expect.poll(() => progress(page)).toEqual(before)
    checkpoints.push({ phase: 'reload-durable', cursor: before.cursor, records: before.records })

    await page.getByRole('button', { name: 'Typing', exact: true }).click()
    checkUrl(page.url(), 'typing')
    await page.reload({ waitUntil: 'domcontentloaded' })
    checkUrl(page.url(), 'typing')
    await page.getByRole('button', { name: 'Learn', exact: true }).click()
    checkUrl(page.url(), 'learn')
    await expect.poll(() => progress(page)).toEqual(before)
    checkpoints.push({ phase: 'switch-and-reenter', cursor: before.cursor, records: before.records })
    expect(observed.browserErrors).toEqual([])
    expect(observed.illegalCloudWrites).toEqual([])
  } finally {
    const path = test.info().outputPath(target + '-dual-learn-redacted.json')
    writeFileSync(path, JSON.stringify({
      schema: 'dual-published-learn-v1', target, sourceSha: target === 'pages' ? expectedSha : null,
      checkpoints, errorCount: observed.browserErrors.length,
      illegalCloudWriteCount: observed.illegalCloudWrites.length,
    }, null, 2))
    await test.info().attach(target + '-dual-learn-redacted.json', {
      path, contentType: 'application/json',
    })
  }
})

test('dual-site: seeded route/reload exploration never corrupts SPA URLs', async ({ page, request }) => {
  test.setTimeout(220_000)
  const observed = track(page)
  await baseline(request)
  const randomChoice = random(seed + (target === 'pages' ? 5 : 29))
  const routeTrail: Checkpoint[] = []
  try {
    await page.goto(fullUrl('typing'), { waitUntil: 'domcontentloaded' })
    for (let i = 0; i < 20; i++) {
      const action = randomChoice()
      if (action < 0.34) {
        await page.reload({ waitUntil: 'domcontentloaded' })
      } else if (action < 0.69) {
        await page.goto(fullUrl('learn'), { waitUntil: 'domcontentloaded' })
      } else {
        await page.goto(fullUrl('typing'), { waitUntil: 'domcontentloaded' })
      }
      await expect(page.getByRole('button', { name: '打开设置对话框' }))
        .toBeVisible({ timeout: 20_000 })
      const path = new URL(page.url()).pathname
      expect([routePath('typing'), routePath('learn')]).toContain(path)
      expect(page.url()).not.toContain('~and~')
      expect(page.url()).not.toContain('?/&/')
      routeTrail.push({ phase: 'step-' + i, pathname: path })
    }
    const canonical = new URL(page.url())
    for (let i = 0; i < 4; i++) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      const current = new URL(page.url())
      expect(current.pathname).toBe(canonical.pathname)
      expect(current.search).toBe(canonical.search)
      expect(current.href).not.toContain('~and~')
    }
    expect(observed.browserErrors).toEqual([])
    expect(observed.illegalCloudWrites).toEqual([])
  } finally {
    const path = test.info().outputPath(target + '-dual-route-redacted.json')
    writeFileSync(path, JSON.stringify({
      schema: 'dual-published-route-v1', target, seed, routeTrail,
      errorCount: observed.browserErrors.length, illegalCloudWriteCount: observed.illegalCloudWrites.length,
    }, null, 2))
    await test.info().attach(target + '-dual-route-redacted.json', { path, contentType: 'application/json' })
  }
})
