import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { reviewWords, seedAcquisitionSession } from './review-flow-harness'

test.setTimeout(60_000)
test.use({ viewport: { width: 1440, height: 900 } })
const words = [...reviewWords, { name: 'confirm', trans: ['确认'], usphone: 'kənfɜːm', ukphone: 'kənfɜːm' }]
const card = (page: Page) => page.locator('[data-desktop-tap-practice]')

async function openTap(page: Page, id: number, phase: 'exposure' | 'supported' | 'independent' = 'independent') {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      const win = window as Window & { __desktopAudioCalls?: number }
      win.__desktopAudioCalls = (win.__desktopAudioCalls ?? 0) + 1
      this.dispatchEvent(new Event('playing'))
      return Promise.resolve()
    }
  })
  await seedAcquisitionSession(page, words, id, phase, 4)
  await page.goto('/learn')
  const toggle = page.getByRole('button', { name: '学习方式：拼写', exact: true })
  await expect(toggle).toBeVisible({ timeout: 30_000 })
  await toggle.click()
  await expect(card(page)).toBeVisible()
  if (await card(page).locator('[data-mobile-paused]').isVisible()) await page.keyboard.press('Enter')
  await expect(card(page).locator('[data-mobile-paused]')).toHaveCount(0)
  return card(page)
}

async function records(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<Array<{
        word: string; wrongCount: number; sourceMode: string
        reviewEvidence?: { memoryGrade: string; reasonCodes: string[]; errorCause: string }
      }>>((resolve, reject) => {
        const all = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').getAll()
        all.onsuccess = () => resolve(all.result)
        all.onerror = () => reject(all.error)
      })
    } finally { db.close() }
  })
}

for (const [key, grade, wrongCount] of [['a', 'again', 1], ['s', 'hard', 0], ['d', 'good', 0]] as const) {
  test('home-row ' + key.toUpperCase() + ' uses the existing ' + grade + ' save path once', async ({ page }) => {
    const practice = await openTap(page, 940100 + wrongCount + key.charCodeAt(0))
    await expect(practice).toHaveAttribute('data-mobile-task', 'recall')
    await expect(practice.locator('[data-mobile-grade="' + grade + '"]')).toHaveAttribute('aria-keyshortcuts', key.toUpperCase() + ' ' + (grade === 'again' ? '1' : grade === 'hard' ? '2' : '3'))
    await page.keyboard.press('Space')
    expect(await records(page)).toHaveLength(0)
    await page.keyboard.press(key)
    if (grade === 'good') {
      await expect(practice).toHaveAttribute('data-mobile-recall-stage', 'verification')
      expect(await records(page)).toHaveLength(0)
    }
    await expect.poll(async () => (await records(page)).length).toBe(1)
    expect((await records(page))[0]).toMatchObject({ wrongCount, sourceMode: 'learn', reviewEvidence: { memoryGrade: grade } })
    expect((await records(page))[0].reviewEvidence?.reasonCodes).toContain('self-report-not-spelling')
  })
}

test('Good correction, pause/resume and held keys preserve one honest result', async ({ page }, testInfo) => {
  const practice = await openTap(page, 940201)
  await page.keyboard.press('d')
  await expect(practice.locator('[data-mobile-answer-revealed]')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(practice.locator('[data-mobile-paused]')).toBeVisible()
  await page.waitForTimeout(2800)
  expect(await records(page)).toHaveLength(0)
  // First X resumes only; the paused control key cannot also correct/rate.
  await page.keyboard.press('x')
  await expect(practice.locator('[data-mobile-paused]')).toHaveCount(0)
  await expect(practice.locator('[data-mobile-recall-correct]')).toBeVisible()
  expect(await records(page)).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath('desktop-tap-correction.png'), fullPage: true })
  await page.keyboard.press('x')
  await expect.poll(async () => (await records(page)).length).toBe(1)
  expect((await records(page))[0].reviewEvidence?.memoryGrade).toBe('again')
  await page.waitForTimeout(2800)
  expect(await records(page)).toHaveLength(1)
  await page.keyboard.press('Space')
  await expect(practice.locator('[data-mobile-feedback]')).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', repeat: true, bubbles: true })))
  expect(await records(page)).toHaveLength(1)
})

test('exposure uses R/Space, shows local keycaps and never repeats across the next task', async ({ page }, testInfo) => {
  const practice = await openTap(page, 940202, 'exposure')
  await expect(practice).toHaveAttribute('data-mobile-task', 'exposure')
  await expect(practice.getByRole('button', { name: '继续学习', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Space')
  const audioCount = () => page.evaluate(() => (window as Window & { __desktopAudioCalls?: number }).__desktopAudioCalls ?? 0)
  const before = await audioCount()
  await page.keyboard.press('r')
  await expect.poll(audioCount).toBeGreaterThan(before)
  await page.screenshot({ path: testInfo.outputPath('desktop-tap-exposure-light.png'), fullPage: true })
  await page.getByRole('button', { name: '开关深色模式' }).click()
  await page.mouse.move(0, 400)
  await page.screenshot({ path: testInfo.outputPath('desktop-tap-exposure-dark.png'), fullPage: true })
  await page.keyboard.press('Space')
  await expect.poll(async () => (await records(page)).length).toBe(1)
  await expect(practice.locator('[data-mobile-feedback]')).toHaveCount(0, { timeout: 6000 })
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true })))
  expect(await records(page)).toHaveLength(1)
})

test('choice keys select the visibly labelled option and keep training evidence', async ({ page }) => {
  const practice = await openTap(page, 940203, 'supported')
  const options = practice.locator('[data-mobile-choice]')
  await expect(options).toHaveCount(4)
  await expect(options.first()).toBeEnabled()
  const selectedWord = await practice.getAttribute('data-mobile-word')
  const labels = await options.evaluateAll(buttons => buttons.map(button =>
    Array.from(button.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()))
  const index = labels.indexOf(selectedWord!)
  expect(index).toBeGreaterThanOrEqual(0)
  await page.keyboard.press(['a', 's', 'd', 'f'][index])
  await expect.poll(async () => (await records(page)).length).toBe(1)
  expect((await records(page))[0]).toMatchObject({ wrongCount: 0, reviewEvidence: { memoryGrade: 'good' } })
  expect((await records(page))[0].reviewEvidence?.reasonCodes).toContain('recognition-or-training-evidence')
})

test('W opens focused spelling; answer letters stay text and Enter submits instead of pausing', async ({ page }) => {
  const practice = await openTap(page, 940204)
  const word = await practice.getAttribute('data-mobile-word')
  await page.keyboard.press('w')
  const input = practice.getByRole('textbox', { name: '独立拼写单词' })
  await expect(input).toBeFocused()
  await page.keyboard.type('asdrwx 123')
  await expect(input).toHaveValue('asdrwx 123')
  expect(await records(page)).toHaveLength(0)
  await input.fill(word!)
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await records(page)).length).toBe(1)
  expect((await records(page))[0].reviewEvidence?.reasonCodes).toContain('objective-spelling-clean')
  await expect(practice.locator('[data-mobile-paused]')).toHaveCount(0)
})

test('spelling mismatch A adjudicates spelling without exposing a false memory failure', async ({ page }) => {
  const practice = await openTap(page, 940205)
  await page.keyboard.press('w')
  await practice.getByRole('textbox', { name: '独立拼写单词' }).fill('wrong-answer')
  await page.keyboard.press('Enter')
  await expect(practice.locator('[data-mobile-spelling-judgment]')).toBeVisible()
  expect(await records(page)).toHaveLength(0)
  await page.keyboard.press('a')
  await expect.poll(async () => (await records(page)).length).toBe(1)
  expect((await records(page))[0].reviewEvidence).toMatchObject({ errorCause: 'spelling', memoryGrade: 'hard' })
})

test('native Tab/Space, IME, modifiers, outside controls and dialogs keep keyboard ownership', async ({ page }, testInfo) => {
  const practice = await openTap(page, 940206)
  await page.evaluate(() => {
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') (window as Window & { __tapTabPrevented?: boolean }).__tapTabPrevented = event.defaultPrevented
    }, { once: true })
  })
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => (window as Window & { __tapTabPrevented?: boolean }).__tapTabPrevented)).toBe(false)
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', isComposing: true, bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', repeat: true, bubbles: true }))
  })
  await page.getByRole('button', { name: '学习方式：轻触', exact: true }).focus()
  await page.keyboard.press('d')
  expect(await records(page)).toHaveLength(0)
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await expect(page.getByRole('button', { name: '关闭设置', exact: true })).toBeVisible()
  await page.keyboard.press('d')
  await page.keyboard.press('Space')
  expect(await records(page)).toHaveLength(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
  await page.keyboard.press('Enter')
  await expect(practice.locator('[data-mobile-paused]')).toHaveCount(0)
  await practice.locator('[data-mobile-grade="again"]').focus()
  await page.keyboard.press('Tab')
  await expect(practice.locator('[data-mobile-grade="hard"]')).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('desktop-tap-recall-focus.png'), fullPage: true })
  await page.keyboard.press('Space')
  await expect.poll(async () => (await records(page)).length).toBe(1)
  expect((await records(page))[0].reviewEvidence?.memoryGrade).toBe('hard')
})


test('number aliases match mouse grades and phone has no desktop keyboard bindings', async ({ page }) => {
  const practice = await openTap(page, 940207)
  await page.keyboard.press('2')
  await expect.poll(async () => (await records(page)).length).toBe(1)
  expect((await records(page))[0].reviewEvidence?.memoryGrade).toBe('hard')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/mobile/study')
  await expect(page.locator('[data-mobile-word-practice]')).toBeVisible()
  await expect(page.locator('[data-desktop-shortcut], .desktop-tap-key, [data-desktop-shortcuts]')).toHaveCount(0)
  const before = (await records(page)).length
  await page.keyboard.press('d')
  expect(await records(page)).toHaveLength(before)
  await expect(practice).toHaveCount(0)
})


test('keyboard cues and action targets stay readable inside short desktop cards in both themes', async ({ page }, testInfo) => {
  const practice = await openTap(page, 940208)
  for (const dark of [false, true]) {
    if (dark) {
      await page.getByRole('button', { name: '开关深色模式' }).click()
      await expect(page.locator('html')).toHaveClass(/dark/)
    }
    for (const [width, height] of [[1024, 700], [1280, 768], [1440, 900]]) {
      await page.setViewportSize({ width, height })
      const actions = practice.locator('[data-mobile-action-zone]')
      const box = (await actions.boundingBox())!
      expect(box.y + box.height).toBeLessThanOrEqual(height)
      await expect(practice.locator('[data-desktop-shortcuts]')).toBeVisible()
      for (const key of ['again', 'hard', 'good']) {
        await expect(practice.locator('[data-mobile-grade="' + key + '"] kbd')).toBeVisible()
      }
      if (width === 1440) {
        await page.mouse.move(0, 400)
        await practice.screenshot({ path: testInfo.outputPath(dark ? 'desktop-tap-keys-dark.png' : 'desktop-tap-keys-light.png') })
      }
    }
  }
  expect(await records(page)).toHaveLength(0)
})
