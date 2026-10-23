import { readReviewModeInfo, reviewWords, seedAcquisitionSession } from './review-flow-harness'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
test.setTimeout(60_000)
const card = (page: Page) => page.locator('[data-mobile-word-practice]')
const input = (page: Page) => card(page).getByRole('textbox', { name: '独立拼写单词' })
async function open(
  page: Page,
  id: number,
  phase: 'independent' | 'exposure' = 'independent',
  audio: 'stub' | 'pending' | 'real' = 'stub',
) {
  if (audio === 'stub')
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = function () {
        this.dispatchEvent(new Event('playing'))
        return Promise.resolve()
      }
    })
  if (audio === 'pending')
    await page.addInitScript(() => {
      ;(window as any).__plays = []
      HTMLMediaElement.prototype.play = function () {
        return new Promise<void>((resolve, reject) => (window as any).__plays.push({ audio: this, resolve, reject }))
      }
    })
  await seedAcquisitionSession(page, reviewWords, id, phase)
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
    } finally {
      db.close()
    }
  })
}
async function menuAndResume(page: Page) {
  await page.getByRole('button', { name: '返回主菜单' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await page.getByRole('link', { name: '继续手机学习' }).click()
  await expect(card(page)).toBeVisible()
}
for (const grade of ['again', 'hard']) {
  test('local ' + grade + ' write failure keeps frozen judgment and exposes a retry', async ({ page }) => {
    await open(page, grade === 'again' ? 970201 : 970202)
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.add
      ;(window as any).__restoreRawWrite = () => {
        IDBObjectStore.prototype.add = original
      }
      IDBObjectStore.prototype.add = function (...args) {
        if (this.name === 'wordRecords') throw new DOMException('Injected local storage failure', 'QuotaExceededError')
        return original.apply(this, args as any)
      }
    })
    await card(page)
      .locator('[data-mobile-grade="' + grade + '"]')
      .click()
    await expect(page.getByRole('alert')).toContainText('保存失败')
    expect(await records(page)).toHaveLength(0)
    await expect(card(page).locator('[data-mobile-answer-revealed]')).toBeVisible()
    await page.evaluate(() => (window as any).__restoreRawWrite())
    await page.getByRole('button', { name: '保存失败 · 重试', exact: true }).click()
    await expect(card(page).locator('[data-mobile-feedback]')).toBeVisible()
    const saved = await records(page)
    expect(saved).toHaveLength(1)
    expect(saved[0].reviewEvidence.memoryGrade).toBe(grade)
    expect(saved[0].learningContext.answerVisibilityAtStart).toBe('hidden')
  })
}

test('browser back and menu preserve partial spelling in the same document', async ({ page }) => {
  await open(page, 970203)
  await card(page).getByRole('button', { name: '学习方式：轻触', exact: true }).click()
  await input(page).fill('ca')
  const original = await readReviewModeInfo(page)
  await page.getByRole('button', { name: '返回主菜单' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await page.goBack()
  await expect(input(page)).toHaveValue('ca')
  await menuAndResume(page)
  await expect(input(page)).toHaveValue('ca')
  expect((await readReviewModeInfo(page)).reviewRecord.id).toBe(original.reviewRecord.id)
  expect(await records(page)).toHaveLength(0)
})

test('saved manual feedback survives menu and does not write a second attempt', async ({ page }) => {
  await open(page, 970204)
  const word = await card(page).getAttribute('data-mobile-word')
  await card(page).locator('[data-mobile-grade="again"]').click()
  await expect(card(page).locator('[data-mobile-manual-next]')).toBeVisible()
  await menuAndResume(page)
  await expect(card(page).locator('[data-mobile-feedback]')).toBeVisible()
  expect(await records(page)).toHaveLength(1)
  await card(page).locator('[data-mobile-manual-next]').click()
  await expect(card(page)).not.toHaveAttribute('data-mobile-word', word!)
  expect(await records(page)).toHaveLength(1)
})

test('leaving the Good verification window preserves reveal and correction without submitting in the menu', async ({ page }) => {
  await open(page, 970205)
  await card(page).locator('[data-mobile-grade="good"]').click()
  await page.getByRole('button', { name: '返回主菜单' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await page.waitForTimeout(2900)
  expect(await records(page)).toHaveLength(0)
  await page.getByRole('link', { name: '继续手机学习' }).click()
  await expect(card(page).locator('[data-mobile-answer-revealed]')).toBeVisible()
  await card(page).locator('[data-mobile-recall-correct]').click()
  await expect(card(page).locator('[data-mobile-feedback]')).toBeVisible()
  expect((await records(page))[0].reviewEvidence.memoryGrade).toBe('again')
})

test('a slow local write completes into the restored card, without duplicate submission', async ({ page }) => {
  await open(page, 970206)
  await menuAndResume(page)
  await page.addScriptTag({
    type: 'module',
    content: `
    import { db } from '/src/utils/db/core.ts';
    const original = db.wordRecords.add.bind(db.wordRecords);
    db.wordRecords.add = (...args) => new Promise((resolve, reject) => {
      window.__finishRawWrite = () => { db.wordRecords.add = original; original(...args).then(resolve, reject) }
    });
  `,
  })
  await card(page).locator('[data-mobile-grade="hard"]').click()
  await page.goBack()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await page.getByRole('link', { name: '继续手机学习' }).click()
  await expect(card(page)).toContainText('正在保存回忆结果')
  await page.evaluate(() => (window as any).__finishRawWrite())
  await expect(card(page).locator('[data-mobile-feedback]')).toBeVisible()
  expect(await records(page)).toHaveLength(1)
  await card(page).locator('[data-mobile-manual-next]').click()
  expect(await records(page)).toHaveLength(1)
})

test('pagehide without document destruction keeps input and feedback paused until explicit resume', async ({ page }) => {
  await open(page, 970207)
  await card(page).getByRole('button', { name: '学习方式：轻触', exact: true }).click()
  await input(page).fill('ca')
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent('pagehide'))
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
  })
  await expect(card(page).locator('[data-mobile-paused]')).toBeVisible()
  await page.waitForTimeout(1200)
  await expect(input(page)).toHaveValue('ca')
  await card(page).locator('[data-mobile-paused]').getByRole('button').click()
  const word = await card(page).getAttribute('data-mobile-word')
  await input(page).fill(word!)
  await input(page).press('Enter')
  await expect(card(page).locator('[data-mobile-feedback]')).toBeVisible()
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(card(page).locator('[data-mobile-paused]')).toBeVisible()
  await page.waitForTimeout(1300)
  await expect(card(page)).toHaveAttribute('data-mobile-word', word!)
  expect(await records(page)).toHaveLength(1)
  await card(page).locator('[data-mobile-paused]').getByRole('button').click()
  await expect(card(page)).not.toHaveAttribute('data-mobile-word', word!)
})

test('paused audio rejects stale playing and error callbacks; explicit resume owns a fresh request', async ({ page }) => {
  await open(page, 970208, 'exposure', 'pending')
  await expect.poll(() => page.evaluate(() => (window as any).__plays.length)).toBeGreaterThan(0)
  await page.evaluate(() => dispatchEvent(new Event('blur')))
  await expect(card(page).locator('[data-mobile-paused]')).toBeVisible()
  await page.evaluate(() => {
    const old = (window as any).__plays
    old.forEach((item: any) => {
      item.audio.dispatchEvent(new Event('playing'))
      item.reject(new DOMException('late error', 'NotAllowedError'))
    })
  })
  await expect(card(page)).not.toHaveAttribute('data-mobile-audio-state', 'playing')
  await expect(card(page)).not.toHaveAttribute('data-mobile-audio-state', 'tap')
  const count = await page.evaluate(() => (window as any).__plays.length)
  await page.evaluate(() => dispatchEvent(new Event('focus')))
  expect(await page.evaluate(() => (window as any).__plays.length)).toBe(count)
  await card(page).locator('[data-mobile-paused]').getByRole('button').click()
  await expect.poll(() => page.evaluate(() => (window as any).__plays.length)).toBeGreaterThan(count)
  await page.evaluate(() => {
    const item = (window as any).__plays.at(-1)
    item.audio.dispatchEvent(new Event('playing'))
    item.resolve()
  })
  await expect(card(page)).toHaveAttribute('data-mobile-audio-state', 'playing')
})

test('blocked and timed-out audio remain recoverable and stale requests cannot overwrite a retry', async ({ page }) => {
  await open(page, 970209, 'exposure', 'pending')
  await expect.poll(() => page.evaluate(() => (window as any).__plays.length)).toBeGreaterThan(0)
  await page.evaluate(() => (window as any).__plays.at(-1).reject(new DOMException('autoplay blocked', 'NotAllowedError')))
  await expect(card(page)).toContainText('点按单词播放发音')
  await card(page)
    .getByRole('button', { name: /点击单词重听/ })
    .click()
  await page.evaluate(() => {
    const all = (window as any).__plays
    const item = all.at(-1)
    item.audio.dispatchEvent(new Event('playing'))
    item.resolve()
    all[0].audio.dispatchEvent(new Event('error'))
  })
  await expect(card(page)).toHaveAttribute('data-mobile-audio-state', 'playing')
  await card(page)
    .getByRole('button', { name: /点击单词重听/ })
    .click()
  await expect(card(page)).toHaveAttribute('data-mobile-audio-state', 'error', { timeout: 12_000 })
  await expect(card(page)).toContainText('发音暂不可用')
  await expect(card(page).getByRole('button', { name: '继续学习', exact: true })).toBeEnabled()
})

test('soft keyboard viewport height and offset keep spelling controls visible while retaining native zoom', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const viewport = new EventTarget() as any
    Object.assign(viewport, { height: 844, offsetTop: 0, scale: 1 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  })
  await open(page, 970210)
  await card(page).getByRole('button', { name: '学习方式：轻触', exact: true }).click()
  await input(page).fill('ca')
  for (const [height, top] of [
    [400, 0],
    [320, 55],
    [460, 12],
  ]) {
    await page.evaluate(
      ({ height, top }) => {
        Object.assign(visualViewport!, { height, offsetTop: top })
        visualViewport!.dispatchEvent(new Event('resize'))
      },
      { height, top },
    )
    const shell = page.locator('[data-mobile-learn-shell]')
    await expect(shell).toHaveCSS('height', height + 'px')
    const field = (await input(page).boundingBox())!
    const button = (await card(page)
      .getByRole('button', { name: /确认拼写/ })
      .boundingBox())!
    expect(field.y).toBeGreaterThanOrEqual(top)
    expect(button.y + button.height).toBeLessThanOrEqual(top + height + 1)
    expect(button.height).toBeGreaterThanOrEqual(44)
    await expect(input(page)).toHaveValue('ca')
  }
  await card(page).screenshot({ path: testInfo.outputPath('keyboard-viewport.png') })
  await page.evaluate(() => {
    Object.assign(visualViewport!, { scale: 1.5 })
    visualViewport!.dispatchEvent(new Event('resize'))
  })
  await expect(page.locator('[data-mobile-learn-shell]')).not.toHaveAttribute('data-mobile-viewport')
})

test('IME Enter is not a spelling confirmation; the following deliberate Enter saves once', async ({ page }) => {
  await open(page, 970211)
  await card(page).getByRole('button', { name: '学习方式：轻触', exact: true }).click()
  await input(page).fill((await card(page).getAttribute('data-mobile-word'))!)
  await input(page).dispatchEvent('compositionstart')
  await input(page).press('Enter')
  expect(await records(page)).toHaveLength(0)
  await input(page).dispatchEvent('compositionend')
  await input(page).press('Enter')
  await expect(card(page).locator('[data-mobile-feedback]')).toBeVisible()
  expect(await records(page)).toHaveLength(1)
})

test('real HTML audio fixture can play after a user gesture without replacing the audio adapter', async ({ page }) => {
  const fixture = fs.readFileSync('public/sounds/key-sound/Alpacas.mp3')
  await page.route('**/dictvoice?**', (route) => route.fulfill({ contentType: 'audio/mpeg', body: fixture }))
  await open(page, 970212, 'exposure', 'real')
  await card(page)
    .getByRole('button', { name: /点击单词重听/ })
    .click()
  await expect.poll(() => card(page).getAttribute('data-mobile-audio-state')).toMatch(/playing|played/)
})

for (const route of ['library', 'settings']) {
  test('mobile fallback recovers ' + route + ' deep link', async ({ page }) => {
    await page.route('**/mobile/' + route + '?simulate-fallback=1', handler => handler.fulfill({ status: 404, contentType: 'text/html', body: fs.readFileSync('public/404.html') }))
    await page.goto('/mobile/' + route + '?simulate-fallback=1')
    await expect(page).toHaveURL(new RegExp('/mobile/' + route + '[?]simulate-fallback=1$'))
    await expect(page.getByRole('heading', { name: route === 'library' ? '选择词库' : '学习设置' })).toBeVisible({ timeout: 30_000 })
  })
}

test('persisted page restoration keeps the existing guarded reload and durable local records', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      this.dispatchEvent(new Event('playing'))
      return Promise.resolve()
    }
  })
  // No pre-boot record fixture here: the real S1 guard owns the reload.
  await page.goto('/mobile/study')
  await expect(card(page)).toBeVisible({ timeout: 30_000 })
  const task = await card(page).getAttribute('data-mobile-task')
  if (task === 'exposure') await card(page).getByRole('button', { name: '继续学习', exact: true }).click()
  else if (task === 'recall') await card(page).locator('[data-mobile-grade="hard"]').click()
  else await card(page).locator('[data-mobile-choice]').first().click()
  await expect(card(page).locator('[data-mobile-feedback]')).toBeVisible()
  await page.getByRole('button', { name: '返回主菜单' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  const before = await records(page)
  expect(before).toHaveLength(1)
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))),
  ])
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 30_000 })
  expect(await records(page)).toEqual(before)
  await expect(page.getByRole('link', { name: '继续手机学习' })).toBeVisible()
})

test('the next word starts fresh and retains its own draft after returning to the menu', async ({ page }) => {
  await open(page, 970213)
  const first = await card(page).getAttribute('data-mobile-word')
  await card(page).locator('[data-mobile-grade="again"]').click()
  await expect(card(page).locator('[data-mobile-feedback]')).toBeVisible()
  await card(page).locator('[data-mobile-manual-next]').click()
  await expect(card(page)).not.toHaveAttribute('data-mobile-word', first!)
  await expect(card(page).locator('[data-mobile-feedback]')).toHaveCount(0)
  const second = await card(page).getAttribute('data-mobile-word')
  await card(page).getByRole('button', { name: '学习方式：轻触', exact: true }).click()
  await input(page).fill(second!.slice(0, 2))
  await menuAndResume(page)
  await expect(card(page)).toHaveAttribute('data-mobile-word', second!)
  await expect(input(page)).toHaveValue(second!.slice(0, 2))
  expect(await records(page)).toHaveLength(1)
})

test('header return waits for an in-flight local answer before leaving the learning page', async ({ page }) => {
  await open(page, 970214)
  await page.addScriptTag({
    type: 'module',
    content: `
    import { db } from '/src/utils/db/core.ts';
    const original = db.wordRecords.add.bind(db.wordRecords);
    db.wordRecords.add = (...args) => new Promise((resolve, reject) => {
      window.__finishHeaderRawWrite = () => { db.wordRecords.add = original; original(...args).then(resolve, reject) }
    });
  `,
  })
  await card(page).locator('[data-mobile-grade="hard"]').click()
  await page.getByRole('button', { name: '返回主菜单' }).click()
  await expect(page.getByRole('dialog')).toContainText('正在保存学习位置')
  await expect(page).toHaveURL(/mobile\/study$/)
  expect(await records(page)).toHaveLength(0)
  await page.evaluate(() => (window as any).__finishHeaderRawWrite())
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  expect(await records(page)).toHaveLength(1)
  await page.getByRole('link', { name: '继续手机学习' }).click()
  await expect(card(page).locator('[data-mobile-feedback]')).toBeVisible()
  expect(await records(page)).toHaveLength(1)
})
