import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { summarizeMobileHistory, localHistoryDate } from '../../src/pages/Mobile/mobile-history'
import { mobileToolHref } from '../../src/pages/Mobile/mobile-data-navigation'
import { selectMobilePhonetic } from '../../src/pages/Mobile/MobilePhonetic'
import type { IWordRecord } from '../../src/utils/db/record'
import { reviewWords, seedAcquisitionSession } from './review-flow-harness'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const fixtureRow = (dict: string, word: string, timestamp: number, review = false): IWordRecord => ({
  dict, word, timeStamp: timestamp, chapter: -1, timing: [400, 600], wrongCount: 0, mistakes: {},
  sourceMode: 'learn', learnItemKind: review ? 'review' : 'acquisition',
})

test('menu completion: calendar filters, cross-dictionary identities and timing are read-only', () => {
  const now = new Date(2026, 9, 24, 12).getTime()
  const day = (daysAgo: number) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); return d.getTime() / 1000 }
  const rows = [fixtureRow('cet4', 'repeat', day(0), true), fixtureRow('cet4', 'repeat', day(0)), fixtureRow('nce1', 'repeat', day(1)), fixtureRow('cet4', 'older', day(8))]
  const original = JSON.stringify(rows)
  expect(summarizeMobileHistory(rows, { period: 7, dictionary: '', now })).toMatchObject({ attempts: 3, uniqueWords: 2, reviews: 1, activeDays: 2, recordedMs: 3000 })
  expect(summarizeMobileHistory(rows, { period: 30, dictionary: 'cet4', now })).toMatchObject({ attempts: 3, uniqueWords: 2 })
  expect(localHistoryDate(now)).toBe('2026-10-24')
  const legacy = { ...rows[0], learnItemKind: undefined, timing: [] }
  expect(summarizeMobileHistory([legacy], { period: 7, dictionary: '', now })).toMatchObject({ reviews: 0, timedAttempts: 0, attempts: 1 })
  expect(JSON.stringify(rows)).toBe(original)
})

test('menu completion: phonetic preference and absent-accent fallback are explicit', () => {
  const word = { ukphone: 'njuːmərəs', usphone: 'numərəs' }
  expect(selectMobilePhonetic(word, 'us')).toMatchObject({ text: 'numərəs', voice: 'us', fallback: false })
  expect(selectMobilePhonetic(word, 'uk')).toMatchObject({ text: 'njuːmərəs', voice: 'uk', fallback: false })
  expect(selectMobilePhonetic({ ...word, usphone: '' }, 'us')).toMatchObject({ text: 'njuːmərəs', voice: 'uk', fallback: true })
  expect(selectMobilePhonetic({ usphone: '', ukphone: '' }, 'uk').text).toBe('')
  expect(mobileToolHref('/?v4-import=manage', 'pages')).toBe('/qwerty-learner/?v4-import=manage')
  expect(mobileToolHref('/?s2-sync=run')).toBe('/?s2-sync=run')
  expect(() => mobileToolHref('https://untrusted.invalid')).toThrow('Unknown mobile data tool')
})

async function home(page: Page) {
  await page.goto('/mobile')
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
}

async function seedHistory(page: Page) {
  await home(page)
  await page.addScriptTag({ type: 'module', content: `
    import { db } from '/src/utils/db/core.ts';
    const at = n => { const date = new Date(); date.setHours(12,0,0,0); date.setDate(date.getDate()-n); return Math.floor(date.getTime()/1000) };
    const row = (dict, word, days, kind) => ({dict, word, timeStamp:at(days), chapter:-1, timing:[400,600], wrongCount:0, mistakes:{}, sourceMode:'learn', learnItemKind:kind});
    await db.wordRecords.bulkAdd([row('cet4','repeat',0,'review'), row('cet4','repeat',0,'acquisition'), row('nce1','repeat',1,'acquisition'), row('cet4','older',8,'review')]);
    window.__mobileMenuSeeded = true;
  ` })
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__mobileMenuSeeded))).toBe(true)
}

async function rawEvidence(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try {
      const names = ['wordRecords', 'chapterRecords', 'reviewRecords', 'reviewWordStates', 'achievementEvents', 'achievementStates']
      const tx = database.transaction(names, 'readonly')
      const rows = await Promise.all(names.map(name => new Promise(resolve => { const item = tx.objectStore(name).getAll(); item.onsuccess = () => resolve([name, item.result]); item.onerror = () => { throw item.error } })))
      return { rows: JSON.stringify(rows), dictionary: localStorage.getItem('currentDict'), checkpoint: localStorage.getItem('reviewModeInfo') }
    } finally { database.close() }
  })
}

test('menu completion: achievements open from home and retain mobile navigation after rotation', async ({ page }) => {
  await home(page)
  await page.getByRole('link', { name: /^成就/ }).click()
  await expect(page).toHaveURL(/\/mobile\/achievements$/)
  await expect(page.getByText('QWERTY Plus · 成就雅集')).toBeVisible({ timeout: 30_000 })
  for (const width of [320, 900]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.getByRole('button', { name: '返回手机首页' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '返回手机首页' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
})

test('menu completion: history filters and daily detail preserve all six tables and current dictionary', async ({ page }) => {
  await seedHistory(page)
  const before = await rawEvidence(page)
  await page.getByRole('link', { name: /^学习记录/ }).click()
  await expect(page.locator('[data-history-attempts]')).toHaveText('3')
  await expect(page.locator('[data-history-words]')).toHaveText('2')
  await page.getByLabel('记录词库').selectOption('cet4')
  await expect(page.locator('[data-history-attempts]')).toHaveText('2')
  await page.getByLabel('记录时间范围').selectOption('30')
  await expect(page.locator('[data-history-attempts]')).toHaveText('3')
  await page.locator('[data-history-day] summary').first().click()
  await expect(page.locator('.mobile-history-words').first()).toContainText('repeat')
  expect(await rawEvidence(page)).toEqual(before)
  await page.setViewportSize({ width: 320, height: 640 })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-history-dark.png', fullPage: true })
  await page.reload()
  await expect(page.locator('[data-mobile-history]')).toBeVisible()
  expect(await rawEvidence(page)).toEqual(before)
})

test('menu completion: empty history and database failure are distinct and retryable', async ({ page }) => {
  await home(page)
  await page.getByRole('link', { name: /^学习记录/ }).click()
  await expect(page.getByText(/所选范围暂无学习记录/)).toBeVisible()
  await page.getByRole('link', { name: '返回首页' }).click()
  await page.evaluate(() => {
    const getAll = IDBObjectStore.prototype.getAll
    ;(window as any).__restoreHistoryRead = () => { IDBObjectStore.prototype.getAll = getAll }
    IDBObjectStore.prototype.getAll = function (...args) {
      if (this.name === 'wordRecords') throw new DOMException('Synthetic read failure', 'UnknownError')
      return getAll.apply(this, args as any)
    }
  })
  await page.getByRole('link', { name: /^学习记录/ }).click()
  await expect(page.getByRole('alert')).toContainText('暂时无法读取学习记录')
  await expect(page.getByText(/所选范围暂无学习记录/)).toHaveCount(0)
  await page.evaluate(() => (window as any).__restoreHistoryRead())
  await page.getByRole('button', { name: '重新读取' }).click()
  await expect(page.getByText(/所选范围暂无学习记录/)).toBeVisible()
})

test('menu completion: mobile local backup exports and validates without writing or importing', async ({ page }) => {
  await seedHistory(page)
  const before = await rawEvidence(page)
  await page.getByRole('link', { name: /^账号与云同步/ }).click()
  await expect(page.getByRole('heading', { name: '账号与云同步', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '立即同步', exact: true })).toHaveCount(0)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出完整备份', exact: true }).click()
  const download = await pending
  const bytes = await readFile(await download.path() as string)
  const archive = JSON.parse(gunzipSync(bytes).toString('utf8'))
  expect(archive.backupFormatVersion).toBe('qwerty-backup-v4')
  expect(archive.workspaceData.database.data.tables).toHaveLength(6)
  expect(archive.workspaceData.database.data.data.find((t: any) => t.tableName === 'wordRecords').rows).toHaveLength(4)
  await expect(page.getByRole('status')).toContainText('备份已导出')
  const choose = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '校验备份文件' }).click()
  await (await choose).setFiles({ name: 'mobile-backup.gz', mimeType: 'application/gzip', buffer: bytes })
  await expect(page.getByRole('status')).toContainText('校验通过')
  const invalid = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '校验备份文件' }).click()
  await (await invalid).setFiles({ name: 'invalid.gz', mimeType: 'application/gzip', buffer: Buffer.from('invalid gzip') })
  await expect(page.getByRole('alert')).toContainText('操作未完成')
  expect(await rawEvidence(page)).toEqual(before)
  await page.setViewportSize({ width: 320, height: 640 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-data.png', fullPage: true })
  await page.locator('.mobile-data-restore summary').click()
  await expect(page.locator('.mobile-data-restore')).toContainText('不是合并')
  await page.route('**/?v4-import=manage', route => route.fulfill({ contentType: 'text/html', body: '<h1>Guarded import entry</h1>' }))
  const historyLength = await page.evaluate(() => history.length)
  await page.getByRole('button', { name: '进入安全导入' }).click()
  await expect(page).toHaveURL(/\/?v4-import=manage$/)
  await expect(page.getByRole('heading', { name: 'Guarded import entry' })).toBeVisible()
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
})

test('menu completion: cloud status is read-only and manual sync hands off to the guarded entry', async ({ page }) => {
  const accountId = 'mobile-menu-fixture-owner'
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
  await page.evaluate(async id => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({ token: 'fixture-only-token', expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { userId: id, username: 'mobile-fixture' } }))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: id })
  }, accountId)
  const cloudRequests: string[] = []
  await page.route('**/api/auth/me', route => route.fulfill({ json: { ok: true, user: { userId: accountId, username: 'mobile-fixture' } } }))
  await page.route('**/api/sync/v2/meta', route => {
    cloudRequests.push(route.request().method())
    return route.fulfill({ json: { ok: true, hasData: true, revision: 7, clientFormatVersion: 'qwerty-backup-v4', logicalFingerprint: 'a'.repeat(64), updatedAt: null, sizeBytes: 100, dataSha256: 'b'.repeat(64), payloadSha256: 'b'.repeat(64), deviceId: null } })
  })
  await page.goto('/mobile/data')
  await expect(page.getByText(/尚未检查云端状态/)).toBeVisible()
  const before = await rawEvidence(page)
  await page.getByRole('button', { name: '刷新云端状态（只读）' }).click()
  await expect(page.getByText(/云端：Revision 7/)).toBeVisible()
  expect(cloudRequests).toEqual(['GET'])
  expect(await rawEvidence(page)).toEqual(before)
  await page.route('**/?s2-sync=run', route => route.fulfill({ contentType: 'text/html', body: '<h1>Guarded sync entry</h1>' }))
  await page.getByRole('button', { name: '立即同步', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Guarded sync entry' })).toBeVisible()
  expect(cloudRequests).toEqual(['GET'])
})

test('menu completion: saved American voice changes the real exposure phonetic', async ({ page }) => {
  await page.addInitScript(() => { HTMLMediaElement.prototype.play = function () { return Promise.resolve() } })
  await seedAcquisitionSession(page, [reviewWords[2]], 981024)
  await page.goto('/mobile/settings')
  await page.getByLabel('发音', { exact: true }).selectOption('us')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByRole('status')).toContainText('设置已保存在本机')
  await page.goto('/mobile/study')
  await expect(page.locator('[data-mobile-phonetic]')).toHaveAttribute('data-phonetic-voice', 'us', { timeout: 30_000 })
  await expect(page.locator('[data-mobile-phonetic]')).toContainText('/numərəs/')
})
