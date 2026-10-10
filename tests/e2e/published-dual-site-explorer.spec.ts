import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'

/**
 * Live public-site Explorer. Both sites are visited as actually deployed.
 * No fixture injection, synthetic IndexedDB rows, cloud account creation,
 * clock override, publish/deploy action, or request credential recording.
 */
const sites = [
  { name: 'pages', base: 'https://smhe00.github.io/qwerty-learner/', origin: 'https://smhe00.github.io', prefix: '/qwerty-learner/', cloud: false },
  { name: 'edgeone', base: 'https://qwerty-plus.edgeone.dev/', origin: 'https://qwerty-plus.edgeone.dev', prefix: '/', cloud: true },
] as const
type Site = (typeof sites)[number]

function checkRoute(page: Page, site: Site) {
  const url = new URL(page.url())
  expect(url.origin).toBe(site.origin)
  expect(url.pathname.startsWith(site.prefix)).toBe(true)
  expect(url.href).not.toContain('~and~')
  expect(url.href).not.toContain('/?/&/')
  expect(url.href).not.toContain('%7Eand%7E')
}

async function checkSite(page: Page, site: Site) {
  checkRoute(page, site)
  await expect(page.getByRole('button', { name: '打开设置对话框' }))
    .toBeVisible({ timeout: 25_000 })
}

async function inspect(page: Page) {
  const scriptErrors: string[] = []
  const forbiddenCloudWrites: string[] = []
  page.on('pageerror', e => scriptErrors.push(e.message))
  // All account/sync mutations belong exclusively to the disposable-account
  // job. This anonymous Explorer blocks them even if a UI regression fires.
  await page.route('**/api/**', async route => {
    const request = route.request()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      forbiddenCloudWrites.push(request.method() + ' ' + new URL(request.url()).pathname)
      await route.abort('blockedbyclient')
    } else {
      await route.continue()
    }
  })
  return {
    verify() {
      expect(scriptErrors, 'uncaught browser exceptions').toEqual([])
      expect(forbiddenCloudWrites, 'no cloud mutation from anonymous Explorer').toEqual([])
    },
  }
}

async function current(page: Page): Promise<{
  id: string | null
  cursor: number | null
  finished: boolean
  learnRows: number
  durableCursor: number | null
}> {
  return page.evaluate(async () => {
    const raw = localStorage.getItem('reviewModeInfo')
    const info = raw ? JSON.parse(raw) : null
    const active = info?.reviewRecord
    const id = active ? String(active.id ?? active.createTime ?? '') : null
    const result = await new Promise<{learnRows:number; durableCursor:number | null}>((resolve, reject) => {
      const opened = indexedDB.open('RecordDB')
      opened.onerror = () => reject(opened.error)
      opened.onsuccess = () => {
        const db = opened.result
        const tx = db.transaction(['reviewRecords', 'wordRecords'], 'readonly')
        const sessions = tx.objectStore('reviewRecords').getAll()
        const records = tx.objectStore('wordRecords').getAll()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
        tx.oncomplete = () => {
          const durable = sessions.result.find((row: {id?:number;createTime?:number}) =>
            String(row.id ?? row.createTime ?? '') === id)
          resolve({
            learnRows: records.result.filter((row: {sourceMode?:string}) => row.sourceMode === 'learn').length,
            durableCursor: durable?.index ?? null,
          })
          db.close()
        }
      }
    })
    return {
      id,
      cursor: active?.index ?? null,
      finished: active?.isFinished === true,
      learnRows: result.learnRows,
      durableCursor: result.durableCursor,
    }
  })
}

async function startLearn(page: Page, site: Site) {
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(site.prefix.replace(/\//g, '\\/') + 'learn\\/?$'), { timeout: 25_000 })
  const prompt = page.getByText(/按任意键(?:开始|继续)/).first()
  const pause = page.getByRole('button', { name: '暂停', exact: true })
  await expect.poll(async () => (await prompt.isVisible().catch(() => false)) ||
    (await pause.isVisible().catch(() => false)), { timeout: 25_000 }).toBe(true)
  if (await prompt.isVisible().catch(() => false)) await page.keyboard.press('a')
  await expect(pause).toBeVisible({ timeout: 15_000 })
}

async function spellOne(page: Page) {
  const node = page.locator('[data-typing-word]:visible').first()
  await expect(node).toHaveAttribute('data-typing-word', /\S+/, { timeout: 20_000 })
  const word = await node.getAttribute('data-typing-word')
  expect(word).toBeTruthy()
  const before = await current(page)
  expect(before.id).toBeTruthy()
  await page.keyboard.type(word!)
  await expect.poll(async () => (await current(page)).learnRows,
    { timeout: 25_000 }).toBe(before.learnRows + 1)
  await expect.poll(async () => {
    const after = await current(page)
    return after.finished || (after.cursor !== null && before.cursor !== null &&
      after.cursor > before.cursor)
  }, { timeout: 20_000 }).toBe(true)
  const after = await current(page)
  expect(after.durableCursor).toBe(after.cursor)
  expect(after.id).toBe(before.id)
  return after
}

for (const site of sites) {
  test.describe('Published dual-site Explorer: ' + site.name, () => {
    test('SPA navigation, route normalization, gallery, analysis and cloud feature separation', async ({
      page, request,
    }) => {
      test.setTimeout(120_000)
      const observer = await inspect(page)
      if (site.name === 'pages') {
        const expected = process.env.PAGES_SOURCE_SHA
        expect(expected).toMatch(/^[a-f0-9]{40}$/)
        await expect.poll(async () => {
          const r = await request.get(site.base + 'source-commit.txt', { failOnStatusCode: false })
          return r.ok() ? (await r.text()).trim() : ''
        }, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toBe(expected)
      } else {
        const response = await request.get(site.base + 'api/health', { failOnStatusCode: false })
        expect(response.status()).toBe(200)
        const health = await response.json() as { service?: string; capabilities?: string[] }
        expect(health.service).toBe('qwerty-sync-gateway')
        expect(health.capabilities).toContain('learning-state-backup-v3')
      }

      await page.goto(site.base, { waitUntil: 'domcontentloaded' })
      await checkSite(page, site)
      await expect(page.getByRole('link', { name: '上海中考2027', exact: true })).toBeVisible()
      await page.getByRole('link', { name: '上海中考2027', exact: true }).click()
      await expect(page).toHaveURL(/\/gallery\/?$/)
      // Gallery has its own shell; the typing-page Settings button is not
      // expected here, but the SPA route must remain canonical.
      checkRoute(page, site)

      await page.goto(site.base + 'analysis?from=learn', { waitUntil: 'domcontentloaded' })
      await expect(page.locator('[data-fsrs-shadow-analysis]')).toBeVisible({ timeout: 25_000 })
      checkRoute(page, site)

      await page.goto(site.base, { waitUntil: 'domcontentloaded' })
      await startLearn(page, site)
      const stablePath = new URL(page.url()).pathname
      for (let index = 0; index < 5; index++) {
        await page.reload({ waitUntil: 'domcontentloaded' })
        await checkSite(page, site)
        expect(new URL(page.url()).pathname).toBe(stablePath)
      }

      await page.getByRole('button', { name: '打开设置对话框' }).click()
      await page.getByRole('tab', { name: '数据设置' }).click()
      if (site.cloud) {
        // EdgeOne master retains the pre-P1 '数据导出' header, while the
        // Pages product/main UI labels the corresponding section '本地备份'.
        await expect(page.getByText('数据导出', { exact: true })).toBeVisible()
        await expect(page.getByText('云端同步', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
      } else {
        await expect(page.getByText('本地备份', { exact: true })).toBeVisible()
        await expect(page.getByText('云端同步与账号', { exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0)
      }
      observer.verify()
    })

    test('real Learn keyboard progress, IndexedDB durability, route switching, repeated reload', async ({ page }) => {
      test.setTimeout(140_000)
      const observer = await inspect(page)
      const checkpoints: Array<{event:string;cursor:number|null;rows:number}> = []
      try {
        await page.goto(site.base, { waitUntil: 'domcontentloaded' })
        await startLearn(page, site)
        const first = await current(page)
        checkpoints.push({ event: 'session', cursor: first.cursor, rows: first.learnRows })
        expect(first.cursor).toBe(0)
        for (let i = 0; i < 3; i++) {
          const after = await spellOne(page)
          checkpoints.push({ event: 'word-committed', cursor: after.cursor, rows: after.learnRows })
        }

        const before = await current(page)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await checkSite(page, site)
        await expect.poll(async () => await current(page)).toEqual(before)
        checkpoints.push({ event: 'reload-retains-durable-state', cursor: before.cursor, rows: before.learnRows })

        await page.getByRole('button', { name: 'Typing', exact: true }).click()
        await checkSite(page, site)
        const typingPath = new URL(page.url()).pathname
        expect(site.cloud ? ['/', '/typing'] : ['/qwerty-learner/', '/qwerty-learner/typing'])
          .toContain(typingPath)
        await page.getByRole('button', { name: 'Learn', exact: true }).click()
        await checkSite(page, site)
        await expect.poll(async () => await current(page)).toEqual(before)
        checkpoints.push({ event: 'mode-roundtrip-retains-progress', cursor: before.cursor, rows: before.learnRows })
        observer.verify()
      } finally {
        // A deliberately minimal numeric trace. No word spelling, PII, cloud
        // keys, tokens or full IndexedDB payloads are ever persisted.
        const output = test.info().outputPath(site.name + '-learn-checkpoints.json')
        writeFileSync(output, JSON.stringify({
          schema: 'dual-site-explorer-v1', site: site.name,
          checkpoints,
        }, null, 2))
        await test.info().attach(site.name + '-learn-checkpoints.json', {
          path: output, contentType: 'application/json',
        })
      }
    })

    test('anonymous Typing never produces Learn records and survives browser refresh', async ({ page }) => {
      test.setTimeout(95_000)
      const observer = await inspect(page)
      await page.goto(site.base, { waitUntil: 'domcontentloaded' })
      await checkSite(page, site)
      const typing = page.getByRole('button', { name: 'Typing', exact: true })
      await typing.click()
      const word = page.locator('[data-typing-word]:visible').first()
      await expect(word).toHaveAttribute('data-typing-word', /\S+/)
      const first = await word.getAttribute('data-typing-word')
      expect(first).toBeTruthy()
      await page.keyboard.press('a')
      await page.keyboard.type(first!)
      await expect.poll(() => word.getAttribute('data-typing-word'),
        { timeout: 20_000 }).not.toBe(first)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await checkSite(page, site)
      const raw = await page.evaluate(async () => {
        const request = indexedDB.open('RecordDB')
        return new Promise<number>((resolve, reject) => {
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const tx = db.transaction('wordRecords', 'readonly')
            const rows = tx.objectStore('wordRecords').getAll()
            rows.onerror = () => reject(rows.error)
            rows.onsuccess = () => {
              resolve(rows.result.filter((r: {sourceMode?:string}) => r.sourceMode === 'learn').length)
              db.close()
            }
          }
        })
      })
      expect(raw).toBe(0)
      observer.verify()
    })

    test('mobile-browser navigation and Learn shell remain accessible', async ({ browser }) => {
      test.setTimeout(100_000)
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true, hasTouch: true,
      })
      try {
        const page = await context.newPage()
        const observer = await inspect(page)
        // Mobile navigation controls may be collapsed in responsive
        // layouts. Verify both published deep links, not an assumed
        // always-visible desktop Settings button.
        await page.goto(site.base, { waitUntil: 'domcontentloaded' })
        checkRoute(page, site)
        await expect(page.locator('[data-typing-word]:visible').first())
          .toHaveAttribute('data-typing-word', /\S+/, { timeout: 20_000 })
        await page.goto(site.base + 'learn', { waitUntil: 'domcontentloaded' })
        checkRoute(page, site)
        await expect(page).toHaveURL(/\/learn\/?$/, { timeout: 20_000 })
        await expect(page.locator('[data-typing-word]:visible').first())
          .toHaveAttribute('data-typing-word', /\S+/, { timeout: 20_000 })
        await page.reload({ waitUntil: 'domcontentloaded' })
        checkRoute(page, site)
        await expect(page.locator('[data-typing-word]:visible').first())
          .toHaveAttribute('data-typing-word', /\S+/, { timeout: 20_000 })
        observer.verify()
      } finally {
        await context.close()
      }
    })
  })
}

/** Reproducible route/state-transition exploration on both published sites. */
for (const site of sites) {
  for (const seed of [20261010, 20261011]) {
    test(site.name + ' seeded navigation explorer ' + seed, async ({ page }) => {
      test.setTimeout(105_000)
      const observer = await inspect(page)
      let state = seed >>> 0
      const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296)
      const evidence: Array<{ step: number; transition: string; route: string }> = []
      try {
        await page.goto(site.base, { waitUntil: 'domcontentloaded' })
        for (let step = 0; step < 14; step++) {
          const p = random()
          let action = 'home'
          if (p < 0.26) {
            action = 'reload'
            await page.reload({ waitUntil: 'domcontentloaded' })
          } else if (p < 0.52) {
            action = 'learn'
            await page.goto(site.base + 'learn', { waitUntil: 'domcontentloaded' })
          } else if (p < 0.80) {
            action = 'typing'
            await page.goto(site.base + 'typing', { waitUntil: 'domcontentloaded' })
          } else {
            await page.goto(site.base, { waitUntil: 'domcontentloaded' })
          }
          await checkSite(page, site)
          evidence.push({ step, transition: action, route: new URL(page.url()).pathname })
        }
        observer.verify()
      } finally {
        const output = test.info().outputPath(site.name + '-route-explorer-' + seed + '.json')
        writeFileSync(output, JSON.stringify({
          schema: 'dual-site-route-explorer-v1',
          site: site.name, seed, evidence,
        }, null, 2))
        await test.info().attach(site.name + '-route-explorer-' + seed + '.json', {
          path: output, contentType: 'application/json',
        })
      }
    })
  }
}
