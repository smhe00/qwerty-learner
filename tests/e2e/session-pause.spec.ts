import { readReviewModeInfo, reviewWords, seedReviewSession } from './review-flow-harness'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function openSession(page: Page, mode: 'typing' | 'learn') {
  if (mode === 'learn') {
    await seedReviewSession(page, reviewWords, 901017)
  } else {
    await page.route('**/dicts/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(reviewWords),
      }),
    )
  }
  await page.goto('/' + mode)
  await expect(page.locator('[data-typing-word="cancel"]')).toBeVisible({ timeout: 30_000 })
}

test.setTimeout(60_000)

for (const mode of ['typing', 'learn'] as const) {
  test(mode + ': shared compact icon, Enter consumes control keys and preserves input/errors/session', async ({ page }) => {
    await openSession(page, mode)
    const control = page.locator('[data-session-control]')
    const word = page.locator('[data-typing-word="cancel"]')
    await expect(control).toHaveAttribute('aria-keyshortcuts', 'Enter')
    const size = await control.boundingBox()
    expect(size?.width).toBe(32)
    expect(size?.height).toBe(32)
    await expect(page.getByText('Start', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Pause', { exact: true })).toHaveCount(0)
    if (mode === 'learn') {
      await expect(page.getByRole('button', { name: /第.*章|章节切换/ })).toHaveCount(0)
    } else {
      await expect(page.getByRole('button', { name: '第 1 章' })).toBeVisible()
    }
    // First non-letter key starts without surrender or error.
    await page.keyboard.press('Escape')
    await expect(word).toHaveAttribute('data-typing-active', 'true')
    await expect(word).toHaveAttribute('data-typing-input', '')
    await page.keyboard.press('x')
    await expect(word).toHaveAttribute('data-typing-wrong-count', '1')
    await expect(word).toHaveAttribute('data-typing-input', '')
    await page.keyboard.type('ca')
    const input = await word.getAttribute('data-typing-input')
    const wrong = await word.getAttribute('data-typing-wrong-count')
    const session = mode === 'learn' ? await readReviewModeInfo(page) : null
    await page.keyboard.press('Enter')
    await expect(word).toHaveAttribute('data-typing-active', 'false')
    const time = await page.locator('[data-session-time]').getAttribute('data-session-time')
    await page.waitForTimeout(1200)
    await expect(page.locator('[data-session-time]')).toHaveAttribute('data-session-time', time!)
    await page.keyboard.press('Backspace')
    await expect(word).toHaveAttribute('data-typing-active', 'true')
    await expect(word).toHaveAttribute('data-typing-input', input!)
    await expect(word).toHaveAttribute('data-typing-wrong-count', wrong!)
    if (session) expect(await readReviewModeInfo(page)).toEqual(session)
    // Native icon activation then a letter resumes without appending the letter.
    await control.click()
    await expect(word).toHaveAttribute('data-typing-active', 'false')
    await page.keyboard.press('x')
    await expect(word).toHaveAttribute('data-typing-active', 'true')
    await expect(word).toHaveAttribute('data-typing-input', input!)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(word).toHaveAttribute('data-typing-input', input!)
    await page.keyboard.type('n')
    await expect(word).toHaveAttribute('data-typing-input', 'can')
  })

  test(mode + ': background pause waits for explicit resume and preserves active timing', async ({ page }) => {
    await openSession(page, mode)
    const word = page.locator('[data-typing-word="cancel"]')
    await page.keyboard.press('Enter')
    await page.keyboard.type('c')
    await page.waitForTimeout(1100)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(word).toHaveAttribute('data-typing-active', 'false')
    const time = await page.locator('[data-session-time]').getAttribute('data-session-time')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(1100)
    await expect(word).toHaveAttribute('data-typing-active', 'false')
    await expect(page.locator('[data-session-time]')).toHaveAttribute('data-session-time', time!)
    await page.keyboard.press('ArrowRight')
    await expect(word).toHaveAttribute('data-typing-input', 'c')
    await page.keyboard.type('ancel')
    await expect(page.locator('[data-typing-word="analyse"]')).toBeVisible()
    const records = await page.evaluate(async () => {
      return await new Promise<any[]>((resolve, reject) => {
        const req = indexedDB.open('RecordDB')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const all = db.transaction('wordRecords').objectStore('wordRecords').getAll()
          all.onsuccess = () => {
            db.close()
            resolve(all.result.filter((r) => r.word === 'cancel'))
          }
          all.onerror = () => reject(all.error)
        }
      })
    })
    expect(records[0].typingTelemetry.backgroundPauseMs).toBeGreaterThanOrEqual(1000)
    expect(records[0].typingTelemetry.attempts[0].durationMs).toBeLessThan(2000)
    expect(Math.max(...records[0].timing)).toBeLessThan(1800)
  })

  test(mode + ': settings controls keep Enter, Tab and text; completed session has no icon', async ({ page }) => {
    await openSession(page, mode)
    const word = page.locator('[data-typing-word="cancel"]')
    await page.keyboard.press('Enter')
    await page.keyboard.type('ca')
    await page.getByRole('button', { name: '打开设置对话框' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: '关闭设置', exact: true })).toBeVisible()
    await expect(word).toHaveAttribute('data-typing-input', 'ca')
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)
    await expect(page.getByRole('button', { name: '关闭设置', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    await page.keyboard.press('Enter')
    await page.keyboard.type('ncel')
    await expect(page.locator('[data-typing-word="analyse"]')).toBeVisible()
    await page.keyboard.type('analyse')
    await expect(page.locator('[data-typing-word="numerous"]')).toBeVisible()
    await page.keyboard.type('numerous')
    await expect(page.locator('[data-session-control]')).toHaveCount(0)
    // The result screen keeps its own existing Enter-to-continue shortcut.
    // Completion itself hides the session pause control.
  })
}

test('Learn Hint survives pause and resume without changing persisted hint evidence', async ({ page }) => {
  await openSession(page, 'learn')
  const word = page.locator('[data-typing-word="cancel"]')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await expect(word).not.toHaveAttribute('data-review-hint-stage', 'cold-probe')
  const hint = await word.getAttribute('data-review-hint-stage')
  const hintLevel = await word.getAttribute('data-review-hint-level')
  const before = await readReviewModeInfo(page)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(word).toHaveAttribute('data-review-hint-stage', hint!)
  await expect(word).toHaveAttribute('data-review-hint-level', hintLevel!)
  expect(await readReviewModeInfo(page)).toEqual(before)
})

test('pausing success feedback does not advance the word until explicit resume', async ({ page }) => {
  await openSession(page, 'typing')
  await page.keyboard.press('Enter')
  await page.keyboard.type('cancel')
  const word = page.locator('[data-typing-word="cancel"]')
  await expect(word).toHaveAttribute('data-typing-success-feedback', 'active')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  await expect(word).toBeVisible()
  await expect(word).toHaveAttribute('data-typing-active', 'false')
  await page.keyboard.press('Space')
  await expect(page.locator('[data-typing-word="analyse"]')).toBeVisible()
})

test('Learn idle has only the header icon and can start with any practice key', async ({ page }) => {
  await page.route('**/dicts/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(reviewWords) }))
  await page.goto('/learn?block-idle=1')
  await expect(page.getByRole('button', { name: '开始 Learn' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Start', { exact: true })).toHaveCount(0)
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('[data-typing-word]').first()).toBeVisible()
  await expect(page.locator('[data-typing-word]').first()).toHaveAttribute('data-typing-active', 'true')
  await expect(page.locator('[data-typing-word]').first()).toHaveAttribute('data-typing-input', '')
})

for (const mode of ['typing', 'learn'] as const) {
  test(mode + ': pause freezes pending error feedback without resetting input or errors', async ({ page }) => {
    await openSession(page, mode)
    await page.keyboard.press('Enter')
    await page.keyboard.press('x')
    const word = page.locator('[data-typing-word="cancel"]')
    await expect(word).toHaveAttribute('data-typing-has-wrong', 'true')
    const input = await word.getAttribute('data-typing-input')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)
    await expect(word).toHaveAttribute('data-typing-input', input!)
    await expect(word).toHaveAttribute('data-typing-wrong-count', '1')
    await page.keyboard.press('ArrowLeft')
    await expect(word).toHaveAttribute('data-typing-input', '')
    await expect(word).toHaveAttribute('data-typing-wrong-count', '1')
  })
}

test('hidden-page pause and held Enter/IME do not resume or mutate a session', async ({ page }) => {
  await openSession(page, 'typing')
  const word = page.locator('[data-typing-word="cancel"]')
  await page.keyboard.press('Enter')
  await page.keyboard.type('ca')
  await page.locator('[data-session-control]').focus()
  await page.keyboard.down('Enter')
  await page.keyboard.down('Enter')
  await page.keyboard.up('Enter')
  await expect(word).toHaveAttribute('data-typing-active', 'false')
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })))
  await expect(word).toHaveAttribute('data-typing-active', 'false')
  await page.keyboard.press('Control+j')
  await expect(word).toHaveAttribute('data-typing-active', 'false')
  await page.keyboard.press('ArrowDown')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(word).toHaveAttribute('data-typing-active', 'false')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(word).toHaveAttribute('data-typing-active', 'false')
  await expect(word).toHaveAttribute('data-typing-input', 'ca')
  await expect(word).toHaveAttribute('data-typing-wrong-count', '0')
})

test('textarea exercise owns Enter while settings retain text editing', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('currentDict', JSON.stringify('coder')))
  await page.route('**/dicts/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(reviewWords) }))
  await page.goto('/typing')
  const word = page.locator('[data-typing-word="cancel"]')
  await expect(word).toBeVisible({ timeout: 30_000 })
  await page.keyboard.press('Enter')
  await page.keyboard.type('ca')
  await expect(word).toHaveAttribute('data-typing-input', 'ca')
  await page.keyboard.press('Enter')
  await expect(word).toHaveAttribute('data-typing-active', 'false')
  await page.keyboard.press('x')
  await expect(word).toHaveAttribute('data-typing-input', 'ca')
  await expect(word).toHaveAttribute('data-typing-wrong-count', '0')
})

test('a practice key after clicking a mode starts the session and releases header focus', async ({ page }) => {
  await page.route('**/dicts/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(reviewWords) }))
  await page.goto('/typing')
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  // The Learn landing stays read-only until a real practice key arrives.
  // The first key starts preparation; it must not be inserted into the word.
  await expect(page.getByText(/按任意键开始 Learn/)).toBeVisible()
  await page.keyboard.press('a')
  const word = page.locator('[data-typing-word]').first()
  await expect(word).toBeVisible({ timeout: 30_000 })
  await expect(word).toHaveAttribute('data-typing-active', 'true')
  await expect(word).toHaveAttribute('data-typing-input', '')
  await page.keyboard.type('ca')
  await expect(word).toHaveAttribute('data-typing-input', 'ca')
})
