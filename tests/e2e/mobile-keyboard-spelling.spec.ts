import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { reviewWords, seedAcquisitionSession } from './review-flow-harness'

test.setTimeout(60_000)
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const card = (page: Page) => page.locator('[data-mobile-word-practice]')
const field = (page: Page) => card(page).getByRole('textbox', { name: '独立拼写单词' })

async function openStudy(page: Page, id: number, phase: 'exposure' | 'independent' = 'independent') {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      const win = window as Window & { __keyboardAudioCalls?: number }
      win.__keyboardAudioCalls = (win.__keyboardAudioCalls ?? 0) + 1
      this.dispatchEvent(new Event('playing'))
      return Promise.resolve()
    }
  })
  await seedAcquisitionSession(page, reviewWords, id, phase, 4)
  await page.goto('/mobile/study')
  await expect(card(page)).toBeVisible({ timeout: 30_000 })
  await expect(card(page).locator('[data-mobile-paused]')).toHaveCount(0)
}

async function records(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<Array<{ word: string; wrongCount: number; reviewEvidence?: { reasonCodes: string[]; memoryGrade: string } }>>((resolve, reject) => {
        const all = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').getAll()
        all.onsuccess = () => resolve(all.result)
        all.onerror = () => reject(all.error)
      })
    } finally { db.close() }
  })
}

test('first trusted letter enters spelling without losing or doubling it, then two words submit continuously', async ({ page }) => {
  await openStudy(page, 950101)
  const first = (await card(page).getAttribute('data-mobile-word'))!
  const sessionId = await page.evaluate(() => JSON.parse(localStorage.getItem('reviewModeInfo') || '{}').reviewRecord.id)
  await page.keyboard.press(first[0])
  await expect(field(page)).toBeFocused()
  await expect(field(page)).toHaveValue(first[0])
  await expect(card(page).locator('[data-mobile-keyboard-hint]')).toContainText('键盘输入')
  await page.keyboard.type(first.slice(1))
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await records(page)).length).toBe(1)
  await expect.poll(() => card(page).getAttribute('data-mobile-word')).not.toBe(first)
  const second = (await card(page).getAttribute('data-mobile-word'))!
  await expect(field(page)).toBeFocused()
  await expect(field(page)).toHaveValue('')
  await page.keyboard.type(second)
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await records(page)).length).toBe(2)
  expect((await records(page)).every(record => record.reviewEvidence?.reasonCodes.includes('objective-spelling-clean'))).toBe(true)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('reviewModeInfo') || '{}').reviewRecord.id)).toBe(sessionId)
})

test('touch default stays unfocused; explicit spelling and touch switch preserve the current word', async ({ page }) => {
  await openStudy(page, 950102)
  const word = await card(page).getAttribute('data-mobile-word')
  await expect(field(page)).toHaveCount(0)
  await expect(card(page).locator('[data-desktop-shortcuts]')).toHaveCount(0)
  await card(page).getByRole('button', { name: '学习方式：轻触', exact: true }).tap()
  await expect(field(page)).toBeFocused()
  await field(page).fill('ca')
  await card(page).getByRole('button', { name: '学习方式：拼写', exact: true }).tap()
  await expect(card(page)).toHaveAttribute('data-mobile-task', 'recall')
  await expect(field(page)).toHaveCount(0)
  await expect(card(page)).toHaveAttribute('data-mobile-word', word!)
  expect(await records(page)).toHaveLength(0)
})

test('keyboard signal after answer reveal waits until the next word and preserves self-report evidence', async ({ page }) => {
  await openStudy(page, 950103)
  const first = await card(page).getAttribute('data-mobile-word')
  await card(page).locator('[data-mobile-grade="good"]').tap()
  await expect(card(page).locator('[data-mobile-answer-revealed]')).toBeVisible()
  await page.keyboard.press('c')
  await expect(card(page)).toHaveAttribute('data-mobile-task', 'recall')
  await expect(field(page)).toHaveCount(0)
  expect(await records(page)).toHaveLength(0)
  await expect.poll(() => card(page).getAttribute('data-mobile-word'), { timeout: 10_000 }).not.toBe(first)
  await expect(field(page)).toBeFocused()
  await expect(field(page)).toHaveValue('')
  const saved = await records(page)
  expect(saved).toHaveLength(1)
  expect(saved[0].reviewEvidence?.reasonCodes).toContain('self-report-not-spelling')
})

test('exposure defers spelling and uses existing keyboard actions without manufacturing a cold probe', async ({ page }) => {
  await openStudy(page, 950104, 'exposure')
  await page.keyboard.press('c')
  await expect(card(page)).toHaveAttribute('data-mobile-task', 'exposure')
  await expect(field(page)).toHaveCount(0)
  await expect(card(page).locator('[data-mobile-keyboard-hint]')).toContainText('回忆阶段优先拼写')
  expect(await records(page)).toHaveLength(0)
  await page.keyboard.press('r')
  await page.keyboard.press('Space')
  await expect.poll(async () => (await records(page)).length).toBe(1)
  expect((await records(page))[0].reviewEvidence?.reasonCodes).toContain('recognition-or-training-evidence')
})

test('explicit touch preference wins; first key enables cues and second key rates normally', async ({ page }) => {
  await openStudy(page, 950105)
  const mode = card(page).locator('[data-mobile-input-preference]')
  await mode.tap()
  await mode.tap()
  await expect(mode).toHaveAttribute('data-mobile-input-preference', 'tap-recall')
  await page.keyboard.press('a')
  expect(await records(page)).toHaveLength(0)
  await expect(field(page)).toHaveCount(0)
  await page.keyboard.press('s')
  await expect.poll(async () => (await records(page)).length).toBe(1)
  expect((await records(page))[0].reviewEvidence?.memoryGrade).toBe('hard')
})

test('composition, modifiers, editors and overlay controls do not activate automatic spelling', async ({ page }) => {
  await openStudy(page, 950106)
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', isComposing: true, bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', repeat: true, bubbles: true }))
  })
  await page.keyboard.press('Control+c')
  await card(page).locator('[data-mobile-input-preference]').focus()
  await page.keyboard.press('c')
  await page.evaluate(() => {
    const editor = document.createElement('input')
    editor.id = 'external-test-editor'
    document.body.append(editor)
    editor.focus()
  })
  await page.keyboard.type('asd')
  await expect(page.locator('#external-test-editor')).toHaveValue('asd')
  await expect(field(page)).toHaveCount(0)
  await expect(card(page).locator('[data-mobile-input-preference]')).toHaveAttribute('data-mobile-input-preference', 'auto')
  await page.evaluate(() => {
    document.querySelector('#external-test-editor')?.remove()
    const dialog = document.createElement('div')
    dialog.id = 'external-test-dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.textContent = 'Overlay keyboard owner'
    document.body.append(dialog)
  })
  await page.keyboard.press('c')
  await expect(field(page)).toHaveCount(0)
  expect(await records(page)).toHaveLength(0)
})

test('Enter activates pause; a resume letter is consumed and held Enter never submits twice', async ({ page }) => {
  await openStudy(page, 950107)
  await page.keyboard.press('Enter')
  await expect(card(page).locator('[data-mobile-paused]')).toBeVisible()
  await page.keyboard.press('c')
  await expect(card(page).locator('[data-mobile-paused]')).toHaveCount(0)
  await expect(field(page)).toHaveCount(0)
  const word = (await card(page).getAttribute('data-mobile-word'))!
  await page.keyboard.press(word[0])
  await expect(field(page)).toHaveValue(word[0])
  await page.keyboard.type(word.slice(1))
  await page.keyboard.down('Enter')
  await page.keyboard.down('Enter')
  await page.keyboard.up('Enter')
  await expect.poll(async () => (await records(page)).length).toBe(1)
  await expect(card(page).locator('[data-mobile-paused]')).toHaveCount(0)
})

test('tablet route and rotation preserve partial input and keep keyboard cues visible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await openStudy(page, 950108)
  await page.keyboard.type('ca')
  await expect(field(page)).toHaveValue('ca')
  for (const [width, height] of [[1024, 768], [390, 844], [768, 1024]]) {
    await page.setViewportSize({ width, height })
    await expect(page).toHaveURL(/\/mobile\/study$/)
    await expect(field(page)).toHaveValue('ca')
    await expect(page.locator('header nav.focus-header-nav')).toHaveCount(0)
    const inputBox = (await field(page).boundingBox())!
    expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(height)
    if (width === 390) await card(page).screenshot({ path: testInfo.outputPath('phone-keyboard-spelling.png') })
  }
  await card(page).screenshot({ path: testInfo.outputPath('tablet-keyboard-spelling.png') })
  expect(await records(page)).toHaveLength(0)
})
