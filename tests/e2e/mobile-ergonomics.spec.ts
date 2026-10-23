import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { reviewWords, seedAcquisitionSession } from './review-flow-harness'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
test.setTimeout(60_000)
const card = (page: Page) => page.locator('[data-mobile-word-practice]')
const field = (page: Page) => card(page).getByRole('textbox', { name: '独立拼写单词' })
async function audio(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__audioPreviews = []
    ;(window as any).__audioStops = 0
    HTMLMediaElement.prototype.play = function () {
      ;(window as any).__audioPreviews.push({ source: this.src, volume: this.volume, rate: this.playbackRate })
      this.dispatchEvent(new Event('playing'))
      return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = function () { (window as any).__audioStops++ }
  })
}
async function open(page: Page, id: number, words = reviewWords, phase: 'independent' | 'exposure' = 'independent') {
  await audio(page)
  await seedAcquisitionSession(page, words, id, phase, 4)
  await page.goto('/mobile/study')
  await expect(card(page)).toBeVisible({ timeout: 30_000 })
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<any[]>((resolve, reject) => {
        const query = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').getAll()
        query.onsuccess = () => resolve(query.result)
        query.onerror = () => reject(query.error)
      })
    } finally { db.close() }
  })
}

test('thumb-zone correction remains reachable after a reading hold and saves frozen pre-reveal evidence once', async ({ page }, info) => {
  await open(page, 980101)
  await card(page).locator('[data-mobile-grade="good"]').tap()
  await card(page).getByRole('button', { name: '停留查看', exact: true }).tap()
  await page.waitForTimeout(3000)
  expect(await records(page)).toHaveLength(0)
  const correction = card(page).locator('[data-mobile-recall-correct]')
  const bounds = (await correction.boundingBox())!
  const footer = (await card(page).locator('[data-mobile-action-zone]').boundingBox())!
  expect(bounds.width).toBeGreaterThanOrEqual(44)
  expect(bounds.height).toBeGreaterThanOrEqual(44)
  expect(bounds.y).toBeGreaterThanOrEqual(footer.y)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844)
  await page.screenshot({ path: info.outputPath('held-correction.png') })
  await card(page).getByRole('button', { name: /^重听答案发音/ }).tap()
  await correction.tap()
  await expect(card(page).locator('[data-mobile-feedback]')).toBeVisible()
  await page.waitForTimeout(2800)
  const saved = await records(page)
  expect(saved).toHaveLength(1)
  expect(saved[0].reviewEvidence.memoryGrade).toBe('again')
  expect(saved[0].learningContext.answerVisibilityAtStart).toBe('hidden')
  expect(saved[0].learningContext.pronunciationPlayed).toBe(false)
})

test('held Good can be explicitly confirmed without regrading or automatic progression', async ({ page }) => {
  await open(page, 980102)
  const word = await card(page).getAttribute('data-mobile-word')
  await card(page).locator('[data-mobile-grade="good"]').tap()
  await card(page).getByRole('button', { name: '停留查看', exact: true }).tap()
  await card(page).getByRole('button', { name: '确认记得', exact: true }).tap()
  await expect(card(page).locator('[data-mobile-manual-next]')).toBeVisible()
  await page.waitForTimeout(1600)
  await expect(card(page)).toHaveAttribute('data-mobile-word', word!)
  expect((await records(page))[0].reviewEvidence.memoryGrade).toBe('good')
  await card(page).locator('[data-mobile-manual-next]').tap()
  await expect(card(page)).not.toHaveAttribute('data-mobile-word', word!)
  expect(await records(page)).toHaveLength(1)
  await expect(card(page)).not.toHaveAttribute('data-mobile-reading-held')
})

test('saved success can stay for reading and replay, including a same-document menu return', async ({ page }) => {
  await open(page, 980103, reviewWords, 'exposure')
  const word = await card(page).getAttribute('data-mobile-word')
  await card(page).getByRole('button', { name: '继续学习', exact: true }).tap()
  await card(page).getByRole('button', { name: '停留查看', exact: true }).tap()
  await card(page).getByRole('button', { name: /^重听答案发音/ }).tap()
  await page.waitForTimeout(1600)
  await expect(card(page)).toHaveAttribute('data-mobile-word', word!)
  await page.getByRole('button', { name: '返回主菜单' }).tap()
  await page.getByRole('link', { name: '继续手机学习' }).tap()
  await expect(card(page).locator('[data-mobile-manual-next]')).toBeVisible()
  await page.waitForTimeout(1300)
  await expect(card(page)).toHaveAttribute('data-mobile-word', word!)
  expect(await records(page)).toHaveLength(1)
})

test('one thumb-zone mode switch preserves half a spelling and stays available in a compact viewport', async ({ page }, info) => {
  await open(page, 980104)
  const mode = card(page).locator('[data-mobile-input-preference]')
  await expect(mode).toHaveCount(1)
  await mode.tap()
  await field(page).fill('ca')
  await mode.tap()
  await expect(field(page)).toHaveCount(0)
  await mode.tap()
  await expect(field(page)).toHaveValue('ca')
  await page.setViewportSize({ width: 320, height: 460 })
  await expect(mode).toBeVisible()
  const bounds = (await mode.boundingBox())!
  const submit = (await card(page).getByRole('button', { name: '确认拼写', exact: true }).boundingBox())!
  expect(bounds.height).toBeGreaterThanOrEqual(44)
  expect(submit.y + submit.height).toBeLessThanOrEqual(461)
  await page.screenshot({ path: info.outputPath('compact-spelling.png') })
  expect(await records(page)).toHaveLength(0)
})

const before = 'When a person wants to stop an arrangement that has been planned for a long time, they need to speak clearly and explain all the reasons to everyone involved, then decide whether to '
const sentence = before + 'cancel' + ' the arrangement or leave it unchanged until another suitable opportunity becomes available for all the people involved.'
const longWords = reviewWords.map((word, i) => i ? word : { ...word, example: [{ en: sentence, cn: '解释安排并决定是否取消。', start: before.length, end: before.length + 6 }] })

test('expanding a long example preserves its masked target and never submits an answer', async ({ page }, info) => {
  await open(page, 980105, longWords)
  await card(page).getByRole('button', { name: '展开完整例句', exact: true }).tap()
  const example = card(page).locator('[data-mobile-example]')
  await expect(example).toHaveAttribute('data-expanded', 'true')
  await expect(example.locator('[data-mobile-keyword]')).toHaveClass(/mobile-practice-blank/)
  expect(await example.locator('[data-mobile-keyword]').textContent()).toMatch(/^_+$/)
  expect(await example.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  expect(await records(page)).toHaveLength(0)
  await card(page).getByRole('button', { name: '收起例句', exact: true }).tap()
  await expect(example).not.toHaveAttribute('data-expanded')
  await page.screenshot({ path: info.outputPath('long-example.png') })
})

test('touching the revealed reading area stops automatic Good persistence', async ({ page }) => {
  await open(page, 980106)
  await card(page).locator('[data-mobile-grade="good"]').tap()
  await card(page).locator('[data-mobile-definition-scroll]').tap()
  await page.waitForTimeout(2900)
  expect(await records(page)).toHaveLength(0)
  await expect(card(page).getByRole('button', { name: '确认记得', exact: true })).toBeVisible()
})

test('audio preview uses unsaved voice/volume/rate, stops on edit and navigation, and never saves those settings', async ({ page }, info) => {
  await audio(page)
  await page.goto('/mobile/settings')
  const saved = await page.evaluate(() => localStorage.getItem('pronunciation'))
  await page.getByLabel('发音', { exact: true }).selectOption('us')
  await page.getByLabel('发音音量').fill('0.35')
  await page.getByLabel('发音语速').fill('0.8')
  await page.getByRole('button', { name: '试听当前发音', exact: true }).tap()
  const playing = await page.evaluate(() => (window as any).__audioPreviews.at(-1))
  expect(playing.source).toContain('type=2')
  expect(playing.volume).toBeCloseTo(0.35)
  expect(playing.rate).toBeCloseTo(0.8)
  expect(await page.evaluate(() => localStorage.getItem('pronunciation'))).toBe(saved)
  await expect(page.getByRole('status')).toContainText('有未保存的设置')
  let stops = await page.evaluate(() => (window as any).__audioStops)
  await page.getByLabel('发音语速').fill('1.2')
  expect(await page.evaluate(() => (window as any).__audioStops)).toBeGreaterThan(stops)
  await page.getByRole('button', { name: '试听当前发音', exact: true }).tap()
  stops = await page.evaluate(() => (window as any).__audioStops)
  await page.screenshot({ path: info.outputPath('settings-preview.png'), fullPage: true })
  await page.getByRole('link', { name: '返回首页', exact: true }).tap()
  expect(await page.evaluate(() => (window as any).__audioStops)).toBeGreaterThan(stops)
  expect(await page.evaluate(() => localStorage.getItem('pronunciation'))).toBe(saved)
})

test('settings save stays reachable on scrolling and display explicitly applies immediately', async ({ page }) => {
  await page.goto('/mobile/settings')
  await page.getByLabel('每日新词目标').fill('15')
  await page.getByLabel('每阶段词数').scrollIntoViewIfNeeded()
  const save = (await page.getByRole('button', { name: '保存设置', exact: true }).boundingBox())!
  expect(save.height).toBeGreaterThanOrEqual(44)
  expect(save.y).toBeGreaterThanOrEqual(0)
  expect(save.y + save.height).toBeLessThanOrEqual(845)
  await page.getByRole('button', { name: '保存设置', exact: true }).tap()
  await expect(page.getByRole('status')).toContainText('设置已保存在本机')
  await expect(page.getByText('立即生效，无需点击保存。', { exact: true })).toBeVisible()
  await page.getByLabel('深色模式').check()
  await expect(page.locator('html')).toHaveClass(/dark/)
})


test('the single mode switch labels an automatically requested spelling probe correctly', async ({ page }) => {
  await audio(page)
  await seedAcquisitionSession(page, reviewWords, 980107, 'independent', 4)
  await page.goto('/mobile')
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
  await page.addScriptTag({ type: 'module', content: `
    import { db } from '/src/utils/db/core.ts';
    await db.wordRecords.bulkAdd([1, 2, 3].map(i => ({
      attemptId: crypto.randomUUID(), dict: 'cet4', word: 'cancel', chapter: -1,
      timeStamp: Math.floor(Date.now() / 1000) - 10 + i,
      timing: [], mistakes: {}, wrongCount: 0, sourceMode: 'learn', learnItemKind: 'review',
      reviewRatingDecision: { eligible: true, rating: 'good', confidence: 1, reasonCodes: [] },
      reviewEvidence: { version: 1, memoryGrade: 'good', errorCause: 'clean', confidence: 1,
        evidenceStrength: 1, retrievalValidity: 'independent', reasonCodes: [
          'self-rated-before-answer-reveal', 'self-report-not-spelling'
        ] }
    })));
    window.__probeHistoryReady = true;
  ` })
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__probeHistoryReady))).toBe(true)
  await page.locator('[data-mobile-menu] .mobile-start-link').click()
  await expect(card(page)).toHaveAttribute('data-mobile-task', 'spelling')
  await card(page).getByRole('button', { name: '学习方式：拼写', exact: true }).tap()
  await expect(card(page)).toHaveAttribute('data-mobile-task', 'recall')
  await expect(card(page).getByRole('button', { name: '学习方式：轻触', exact: true })).toBeVisible()
  expect(await records(page)).toHaveLength(3)
})
