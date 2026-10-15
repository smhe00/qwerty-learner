import { expect, test } from '@playwright/test'
import {
  reviewWords,
  seedReviewSession,
  startTyping,
  waitForActiveLearnSession,
  waitForRenderedWord,
  waitForReviewIndex,
} from './review-flow-harness'

const longWord = 'antidisestablishmentarianism'

test('Focus standard English technology stays on one line at desktop and tablet widths', async ({ page }) => {
  test.setTimeout(80_000)
  const sample = 'technology'
  await page.setViewportSize({ width: 1474, height: 900 })
  await seedReviewSession(page, [{
    name: sample, trans: ['科技'], usphone: 'tekˈnɑlədʒi', ukphone: 'tekˈnɒlədʒi',
  }], 902100)
  await page.goto('/learn')
  await waitForActiveLearnSession(page)
  await startTyping(page)
  await waitForRenderedWord(page, sample)

  for (const width of [1474, 1024, 768, 480, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const layout = await page.evaluate(() => {
      const word = document.querySelector('[data-typing-word="technology"]') as HTMLElement
      const spans = [...word.children] as HTMLElement[]
      const rects = spans.map(el => el.getBoundingClientRect())
      return {
        rows: new Set(rects.map(r => Math.round(r.top))).size,
        visible: rects.every(r => r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1),
        letterCount: spans.length,
      }
    })
    expect(layout.letterCount).toBe(sample.length)
    expect(layout.rows, `Unexpected technology wrap at viewport ${width}`).toBe(1)
    expect(layout.visible, `Clipped technology letters at viewport ${width}`).toBe(true)
  }
  // Geometry-only correction must not change the spelling or input handling.
  await page.keyboard.type('tech')
  await expect(page.locator('[data-typing-word="technology"]'))
    .toHaveAttribute('data-typing-input', 'tech')
})

test('Focus P2 keeps every long-word letter inside the zoomed study viewport', async ({ page }) => {
  test.setTimeout(80_000)
  await page.setViewportSize({ width: 1024, height: 430 })
  await seedReviewSession(page, [{
    name: longWord,
    trans: ['反政教分离主义'],
    usphone: 'ˌæntiˌdɪsəstæblɪʃmənˈteəriənɪzəm',
    ukphone: 'ˌæntɪˌdɪsəstæblɪʃmənˈteəriənɪzəm',
  }], 902101)
  await page.goto('/learn')
  await waitForActiveLearnSession(page)
  await startTyping(page)
  await waitForRenderedWord(page, longWord)

  // CSS zoom simulates 200% display scaling without changing user font
  // preferences, completion algorithms or the source dictionary.
  await page.evaluate(() => { document.documentElement.style.zoom = '2' })
  const letters = page.locator('[data-typing-word="' + longWord + '"] > span')
  await expect(letters).toHaveCount(longWord.length)
  await expect.poll(async () => page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-typing-word="antidisestablishmentarianism"] > span')]
    if (nodes.length !== 28) return false
    return nodes.every(node => {
      const rect = node.getBoundingClientRect()
      return rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.width > 0
    })
  }), { timeout: 10_000 }).toBe(true)

  const layout = await page.evaluate(() => {
    const main = document.querySelector('main.focus-app-shell') as HTMLElement
    const word = document.querySelector('[data-typing-word="antidisestablishmentarianism"]') as HTMLElement
    const spans = [...word.children] as HTMLElement[]
    return {
      scrollableHeight: main.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
      rows: new Set(spans.map(el => Math.round(el.getBoundingClientRect().top))).size,
      fontSize: getComputedStyle(spans[0]).fontSize,
    }
  })
  expect(layout.scrollableHeight).toBeGreaterThan(layout.viewportHeight)
  expect(layout.rows).toBeGreaterThan(1)
  expect(layout.fontSize).not.toBe('0px')

  await page.keyboard.type('anti')
  await expect(page.locator('[data-typing-word="' + longWord + '"]'))
    .toHaveAttribute('data-typing-input', 'anti')
  await page.screenshot({
    path: 'test-results/focus-p2/long-word-zoom-200.png',
    fullPage: false, animations: 'disabled', timeout: 15_000,
  })
})

test('Focus P2 lets the sixth extra-round metric fit without pushing a whole orphan row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await seedReviewSession(page, reviewWords, 902102)
  await page.goto('/learn')
  const stats = page.locator('[data-learn-live-stats]')
  await expect(stats).toBeVisible({ timeout: 20_000 })
  await expect(stats).toHaveAttribute('data-stat-count', '5')

  // Simulate the extra-round presentation state only. This checks the CSS
  // contract without mutating scheduled words or persisted session progress.
  await stats.evaluate(node => {
    node.setAttribute('data-stat-count', '6')
    const sample = node.lastElementChild!.cloneNode(true) as HTMLElement
    sample.querySelector('.focus-stat-label')!.textContent = '本轮待完成'
    node.appendChild(sample)
  })
  const geometry = async () => stats.evaluate(node => {
    const strip = node.getBoundingClientRect()
    const cells = [...node.children].map(child => child.getBoundingClientRect())
    return {
      count: cells.length,
      rows: new Set(cells.map(rect => Math.round(rect.top))).size,
      overflow: cells.some(rect => rect.right > strip.right + 1 || rect.left < strip.left - 1),
    }
  })
  expect(await geometry()).toEqual({ count: 6, rows: 1, overflow: false })

  await page.setViewportSize({ width: 840, height: 800 })
  await expect.poll(async () => (await geometry()).rows).toBe(2)
  await expect.poll(async () => (await geometry()).overflow).toBe(false)
  await page.screenshot({
    path: 'test-results/focus-p2/six-metrics-840.png',
    fullPage: false, animations: 'disabled', timeout: 15_000,
  })
})

test('Focus P2 keeps a reachable 44px close target on a completed Block', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 860, height: 560 })
  await seedReviewSession(page, reviewWords, 902103)
  await page.goto('/learn')
  await waitForActiveLearnSession(page)
  await startTyping(page)
  for (const [index, name] of ['cancel', 'analyse', 'numerous'].entries()) {
    await waitForRenderedWord(page, name)
    await page.keyboard.type(name)
    if (index < 2) await waitForReviewIndex(page, index + 1)
  }
  const result = page.locator('[data-learn-result-screen]')
  await expect(result).toBeVisible({ timeout: 20_000 })
  const close = result.getByRole('button', { name: '暂停 Learn' })
  const rect = await close.boundingBox()
  expect(rect).not.toBeNull()
  expect(rect!.width).toBeGreaterThanOrEqual(44)
  expect(rect!.height).toBeGreaterThanOrEqual(44)
  await expect(result.getByRole('button', { name: '按任意键继续' })).toBeVisible()
  await page.screenshot({
    path: 'test-results/focus-p2/block-responsive-860.png',
    fullPage: false, animations: 'disabled', timeout: 15_000,
  })
})
