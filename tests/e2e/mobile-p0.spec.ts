import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function countWordRecords(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<number>((resolve, reject) => {
        const count = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').count()
        count.onsuccess = () => resolve(count.result)
        count.onerror = () => reject(count.error)
      })
    } finally { db.close() }
  })
}

async function mockWordPronunciation(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play
    ;(window as Window & { __mobileAudioAutoCalls?: number }).__mobileAudioAutoCalls = 0
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes('dictvoice')) {
        const win = window as Window & { __mobileAudioAutoCalls?: number }
        win.__mobileAudioAutoCalls = (win.__mobileAudioAutoCalls ?? 0) + 1
        this.dispatchEvent(new Event('playing'))
        return Promise.resolve()
      }
      return original.call(this)
    }
  })
}

test.use({ viewport: { width: 390, height: 844 } })

test('Mobile keeps the independent app menu without Typing controls', async ({ page }) => {
  await page.goto('/mobile')
  const menu = page.locator('[data-mobile-menu]')
  await expect(menu).toBeVisible({ timeout: 25_000 })
  await expect(menu.getByRole('heading', { name: /QWERTY/ })).toBeVisible()
  await expect(menu.getByRole('link', { name: '开始手机学习' })).toBeVisible()
  await expect(menu.getByText('账号与云同步', { exact: true })).toBeVisible()
  await expect(menu.getByText('设置', { exact: true })).toBeVisible()
  await expect(menu.getByText('即将开放', { exact: true })).toHaveCount(5)
  await expect(page.locator('header nav.focus-header-nav')).toHaveCount(0)
  const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(bounds.width).toBeLessThanOrEqual(bounds.viewport + 1)
})

test('Mobile single-tap choice or two-tap recall saves then advances automatically', async ({ page }) => {
  await mockWordPronunciation(page)
  await page.goto('/mobile/study')
  const taskView = page.locator('[data-mobile-word-practice]')
  await expect(taskView).toBeVisible({ timeout: 45_000 })
  await expect(page.getByRole('button', { name: '暂停学习' })).toBeVisible()
  await expect(page.locator('input, textarea, [data-typing-input-control]')).toHaveCount(0)

  const task = await taskView.getAttribute('data-mobile-task')
  const before = await countWordRecords(page)
  if (task === 'exposure') {
    await expect.poll(async () => page.evaluate(() =>
      (window as Window & { __mobileAudioAutoCalls?: number }).__mobileAudioAutoCalls ?? 0,
    )).toBeGreaterThan(0)
    await page.getByRole('button', { name: '继续学习' }).click()
  } else if (task === 'recall') {
    await page.getByRole('button', { name: '显示答案' }).click()
    await expect(page.locator('[data-mobile-answer-revealed]')).toBeVisible()
    await expect(page.locator('[data-mobile-grade]')).toHaveCount(3)
    expect(await countWordRecords(page)).toBe(before)
    await page.locator('[data-mobile-grade="good"]').click()
  } else {
    if (task === 'audio') {
      await expect.poll(async () => page.evaluate(() =>
        (window as Window & { __mobileAudioAutoCalls?: number }).__mobileAudioAutoCalls ?? 0,
      )).toBeGreaterThan(0)
    }
    await page.locator('[data-mobile-choice]').first().click()
  }

  await expect(page.locator('[data-mobile-feedback]')).toBeVisible()
  expect(await countWordRecords(page)).toBe(before + 1)
  await expect(page.getByRole('button', { name: '确认选择' })).toHaveCount(0)
  const nextMode = await taskView.getAttribute('data-mobile-next-mode')
  if (nextMode === 'manual') {
    await expect(page.locator('[data-mobile-manual-next]')).toBeVisible()
    // An incorrect choice must leave its explanation on screen.
    await page.waitForTimeout(1800)
    await expect(page.locator('[data-mobile-feedback]')).toBeVisible()
    expect(await countWordRecords(page)).toBe(before + 1)
    await page.locator('[data-mobile-manual-next]').click()
  } else {
    expect(nextMode).toBe('auto')
    await expect(page.locator('[data-mobile-manual-next]')).toHaveCount(0)
  }
  await expect(page.locator('[data-mobile-feedback]')).toHaveCount(0, { timeout: 7_000 })
  await expect(page.locator('[data-mobile-word-practice], [data-mobile-complete]')).toBeVisible()
})

test('Mobile tap targets remain anchored at the bottom thumb zone', async ({ page }) => {
  await mockWordPronunciation(page)
  await page.goto('/mobile/study')
  await expect(page.locator('[data-mobile-word-practice]')).toBeVisible({ timeout: 45_000 })
  const action = page.locator('[data-mobile-action-zone]')
  await expect(action).toBeVisible()
  const metrics = await action.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight }
  })
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewport + 1)
  expect(metrics.bottom).toBeGreaterThan(metrics.viewport * 0.72)
  expect(metrics.top).toBeGreaterThan(metrics.viewport * 0.54)
  await expect(page.locator('input, textarea')).toHaveCount(0)
})

test('Mobile pause freezes its word and resume does not open a keyboard', async ({ page }) => {
  await mockWordPronunciation(page)
  await page.goto('/mobile/study')
  await expect(page.locator('[data-mobile-word-practice]')).toBeVisible({ timeout: 45_000 })
  await expect(page.getByRole('button', { name: '暂停学习' })).toBeVisible()
  await page.getByRole('button', { name: '暂停学习' }).click()
  await expect(page.locator('[data-mobile-paused]')).toBeVisible()
  await expect(page.locator('input, textarea')).toHaveCount(0)
  await page.locator('[data-mobile-paused]').getByRole('button', { name: '继续学习' }).click()
  await expect(page.locator('[data-mobile-paused]')).toHaveCount(0)
  await expect(page.locator('[data-mobile-word-practice]')).toBeVisible()
})


test('Mobile narrow screens keep the actions visible without horizontal scroll', async ({ page }) => {
  await mockWordPronunciation(page)
  for (const width of [320, 360, 430]) {
    await page.setViewportSize({ width, height: 740 })
    await page.goto('/mobile/study')
    await expect(page.locator('[data-mobile-word-practice]')).toBeVisible({ timeout: 45_000 })
    const bounds = await page.evaluate(() => {
      const footer = document.querySelector('[data-mobile-action-zone]')?.getBoundingClientRect()
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        footerBottom: footer?.bottom ?? 0,
        footerTop: footer?.top ?? 0,
      }
    })
    expect(bounds.pageWidth).toBeLessThanOrEqual(bounds.viewportWidth + 1)
    expect(bounds.footerBottom).toBeLessThanOrEqual(bounds.viewportHeight + 1)
    expect(bounds.footerBottom).toBeGreaterThan(bounds.viewportHeight * .72)
    expect(bounds.footerTop).toBeGreaterThan(bounds.viewportHeight * .5)
  }
})


test('Mobile full word stays at the top when a long definition occupies all remaining room', async ({ page }) => {
  await mockWordPronunciation(page)
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/mobile/study')
    const practice = page.locator('[data-mobile-word-practice]')
    await expect(practice).toBeVisible({ timeout: 45_000 })
    if (await practice.getAttribute('data-mobile-task') === 'recall') {
      await page.getByRole('button', { name: '显示答案' }).click()
    }

    const result = await practice.evaluate((element) => {
      const reading = element.querySelector('[data-mobile-reading]') as HTMLElement
      const wordSlot = element.querySelector('[data-mobile-word-slot]') as HTMLElement
      const exampleSlot = element.querySelector('[data-mobile-example-slot]') as HTMLElement
      const meaningSlot = element.querySelector('[data-mobile-meaning-slot]') as HTMLElement
      const content = element.querySelector('[data-mobile-definition-scroll]') as HTMLElement
      const word = wordSlot.querySelector('.mobile-practice-word') as HTMLElement | null
      const meaning = meaningSlot.querySelector('.mobile-practice-meaning') as HTMLElement | null
      // The same layout must handle unusually long content regardless of
      // the randomly scheduled learning task.
      if (!word) {
        wordSlot.innerHTML = '<h2 class="mobile-practice-word">characteristicallylongtargetword</h2>'
      }
      if (!meaning) {
        content.innerHTML = '<p class="mobile-practice-meaning"></p>'
      }
      const longMeaning = content.querySelector('.mobile-practice-meaning') as HTMLElement
      const shownWord = wordSlot.querySelector('.mobile-practice-word') as HTMLElement
      longMeaning.textContent = '中文释义与复习说明，'.repeat(90)
      const first = shownWord.getBoundingClientRect()
      const firstScroll = content.scrollHeight
      const firstClient = content.clientHeight
      const example = exampleSlot.getBoundingClientRect()
      const definitions = meaningSlot.getBoundingClientRect()
      return {
        wordTop: first.top,
        wordBottom: first.bottom,
        wordHeight: first.height,
        wordScrollHeight: shownWord.scrollHeight,
        readingTop: reading.getBoundingClientRect().top,
        readingBottom: reading.getBoundingClientRect().bottom,
        exampleTop: example.top,
        exampleBottom: example.bottom,
        definitionTop: definitions.top,
        definitionBottom: definitions.bottom,
        lineClamp: getComputedStyle(longMeaning).webkitLineClamp,
        definitionClient: firstClient,
        definitionScroll: firstScroll,
        wordClipped: shownWord.scrollWidth > shownWord.clientWidth + 1,
      }
    })
    expect(result.wordTop).toBeGreaterThanOrEqual(result.readingTop - 1)
    expect(result.wordBottom).toBeLessThanOrEqual(result.readingBottom + 1)
    expect(result.wordHeight).toBeGreaterThanOrEqual(result.wordScrollHeight - 1)
    expect(result.wordClipped).toBe(false)
    expect(result.exampleTop).toBeGreaterThanOrEqual(result.wordBottom - 1)
    expect(result.exampleTop - result.wordBottom).toBeLessThan(35)
    expect(result.definitionTop).toBeGreaterThanOrEqual(result.exampleBottom - 1)
    expect(result.definitionBottom).toBeLessThanOrEqual(result.readingBottom + 1)
    expect(result.lineClamp).toBe('none')
    expect(result.definitionScroll).toBeGreaterThan(result.definitionClient)
    await expect(page.locator('[data-mobile-action-zone]')).toBeVisible()
  }
})

test('Mobile example uses three lines and highlights only the hidden cloze before reveal', async ({ page }) => {
  await mockWordPronunciation(page)
  await page.goto('/mobile/study')
  const practice = page.locator('[data-mobile-word-practice]')
  await expect(practice).toBeVisible({ timeout: 45_000 })
  const mode = await practice.getAttribute('data-mobile-task')
  const example = practice.locator('[data-mobile-example]')
  if (await example.count()) {
    const metrics = await example.evaluate((element) => {
      const css = getComputedStyle(element)
      return {
        lines: css.webkitLineClamp,
        reservedHeight: element.getBoundingClientRect().height,
        fontSize: parseFloat(css.fontSize),
        lineHeight: parseFloat(css.lineHeight),
      }
    })
    expect(metrics.lines).toBe('3')
    expect(metrics.reservedHeight).toBeLessThanOrEqual(metrics.fontSize * 1.55 * 3 + 2)
    expect(metrics.reservedHeight).toBeGreaterThanOrEqual(metrics.fontSize * 1.55 * 2.8)
    const keyword = example.locator('[data-mobile-keyword]')
    await expect(keyword).toHaveCount(1)
    if (mode === 'recall' || mode === 'context') {
      await expect(keyword).toHaveClass(/mobile-practice-blank/)
      const masked = await keyword.textContent()
      expect(masked).toMatch(/_{3,}/)
      if (mode === 'recall') {
        await practice.getByRole('button', { name: '显示答案' }).click()
        await expect(keyword).toHaveClass(/mobile-practice-keyword/)
        const revealed = await keyword.textContent()
        expect(revealed).not.toContain('_')
      }
    } else {
      await expect(keyword).toHaveClass(/mobile-practice-keyword/)
    }
  }
})


test('Mobile never auto-advances after Hard or wrong; manual next preserves one saved attempt', async ({ page }) => {
  await mockWordPronunciation(page)
  await page.goto('/mobile/study')
  const taskView = page.locator('[data-mobile-word-practice]')
  await expect(taskView).toBeVisible({ timeout: 45_000 })

  for (let turn = 0; turn < 8; turn += 1) {
    const task = await taskView.getAttribute('data-mobile-task')
    const before = await countWordRecords(page)
    if (task === 'exposure') {
      await taskView.getByRole('button', { name: '继续学习' }).click()
    } else if (task === 'recall') {
      await taskView.getByRole('button', { name: '显示答案' }).click()
      await taskView.locator('[data-mobile-grade="hard"]').click()
    } else {
      const choices = taskView.locator('[data-mobile-choice]')
      await expect(choices.first()).toBeEnabled({ timeout: 15_000 })
      const target = await taskView.getAttribute('data-mobile-word')
      // On cloze/audio tasks, choose a definitely wrong English spelling.
      // On meaning-choice tasks, any wrong answer is enough; if the first
      // option happens to be right the loop proceeds to another task.
      const labels = await choices.allTextContents()
      const wrongIndex = task === 'meaning-choice' ? 0 : labels.findIndex(label => label.trim() !== target)
      await choices.nth(Math.max(0, wrongIndex)).click()
    }

    await expect(taskView.locator('[data-mobile-feedback]')).toBeVisible({ timeout: 15_000 })
    const nextMode = await taskView.getAttribute('data-mobile-next-mode')
    if (nextMode === 'manual') {
      expect(await countWordRecords(page)).toBe(before + 1)
      await expect(taskView.locator('[data-mobile-manual-next]')).toBeVisible()
      const finishedWord = await taskView.getAttribute('data-mobile-word')
      await page.waitForTimeout(2000)
      await expect(taskView.locator('[data-mobile-feedback]')).toBeVisible()
      await expect(taskView).toHaveAttribute('data-mobile-word', finishedWord!)
      expect(await countWordRecords(page)).toBe(before + 1)
      await taskView.locator('[data-mobile-manual-next]').click()
      await expect(taskView.locator('[data-mobile-feedback]')).toHaveCount(0, { timeout: 7_000 })
      expect(await countWordRecords(page)).toBe(before + 1)
      return
    }

    expect(nextMode).toBe('auto')
    await expect(taskView.locator('[data-mobile-feedback]')).toHaveCount(0, { timeout: 7_000 })
  }
  throw new Error('Expected a wrong or Hard response within eight learning tasks')
})
