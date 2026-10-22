import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { reviewWords, seedAcquisitionSession } from './review-flow-harness'
import { selectLearnTask } from '../../src/learn/task-selector'

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
  await expect(menu.getByText('即将开放', { exact: true })).toHaveCount(4)
  await expect(menu.getByRole('link', { name: /账号与云同步/ })).toHaveAttribute('href', '/mobile/account')
  await expect(menu.locator('[data-mobile-account-entry]')).toHaveAttribute('href', '/mobile/account')
  await expect(page.locator('header nav.focus-header-nav')).toHaveCount(0)
  const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(bounds.width).toBeLessThanOrEqual(bounds.viewport + 1)
})

test('Mobile single-tap choice or pre-reveal self-rating saves then advances automatically', async ({ page }) => {
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
    await expect(page.locator('[data-mobile-answer-revealed]')).toHaveCount(0)
    await expect(page.locator('[data-mobile-grade]')).toHaveCount(3)
    expect(await countWordRecords(page)).toBe(before)
    await page.locator('[data-mobile-grade="good"]').click()
    await expect(page.locator('[data-mobile-answer-revealed]')).toBeVisible()
    await expect(taskView).toHaveAttribute('data-mobile-recall-stage', 'verification')
    // The positive self-report is still amendable and not durable yet.
    expect(await countWordRecords(page)).toBe(before)
    const correction = taskView.locator('[data-mobile-recall-correct]')
    await expect(correction).toBeVisible()
    await expect(correction).toHaveAttribute('aria-label', '我记错了，改为忘了')
    const correctionBox = await correction.boundingBox()
    const actionBox = await taskView.locator('[data-mobile-action-zone]').boundingBox()
    expect(correctionBox).not.toBeNull()
    expect(actionBox).not.toBeNull()
    expect(correctionBox!.width).toBeLessThanOrEqual(34)
    expect(correctionBox!.height).toBeLessThanOrEqual(34)
    expect(correctionBox!.y + correctionBox!.height).toBeLessThan(actionBox!.y)
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
      await practice.locator('[data-mobile-grade="hard"]').click()
      await expect(practice.locator('.mobile-practice-word')).toBeVisible()
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
        expect(await countWordRecords(page)).toBe(0)
        await practice.locator('[data-mobile-grade="good"]').click()
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


test('Mobile self-report Good can be corrected to Again before saving', async ({ page }) => {
  await mockWordPronunciation(page)
  await page.goto('/mobile/study')
  const taskView = page.locator('[data-mobile-word-practice]')
  await expect(taskView).toBeVisible({ timeout: 45_000 })

  // The first new session is typically Exposure. Continue through the
  // training phases until the first recall; no hard-coded word or order.
  for (let turn = 0; turn < 36; turn += 1) {
    const task = await taskView.getAttribute('data-mobile-task')
    if (task === 'recall') {
      const before = await countWordRecords(page)
      await expect(taskView).toHaveAttribute('data-mobile-recall-stage', 'unrevealed')
      await expect(taskView.locator('[data-mobile-answer-revealed]')).toHaveCount(0)
      await taskView.locator('[data-mobile-grade="good"]').click()
      await expect(taskView.locator('[data-mobile-answer-revealed]')).toBeVisible()
      expect(await countWordRecords(page)).toBe(before)
      await taskView.locator('[data-mobile-recall-correct]').click()
      await expect(taskView.locator('[data-mobile-feedback]')).toBeVisible()
      await expect(taskView).toHaveAttribute('data-mobile-next-mode', 'manual')
      expect(await countWordRecords(page)).toBe(before + 1)
      const rows = await page.evaluate(async (name: string) => {
        const request = indexedDB.open('RecordDB')
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        try {
          return await new Promise<Array<{
            reviewEvidence?: { memoryGrade: string; reasonCodes: string[] }
            reviewRatingDecision?: { rating: string | null; eligible: boolean }
          }>>((resolve, reject) => {
            const request = db.transaction('wordRecords', 'readonly')
              .objectStore('wordRecords').getAll()
            request.onsuccess = () => resolve(request.result.filter(
              (row: { word: string }) => row.word === name,
            ))
            request.onerror = () => reject(request.error)
          })
        } finally { db.close() }
      }, (await taskView.getAttribute('data-mobile-word'))!)
      const record = rows.at(-1)!
      expect(record.reviewEvidence?.memoryGrade).toBe('again')
      expect(record.reviewEvidence?.reasonCodes).toContain('self-rated-before-answer-reveal')
      // No second Good event may be fabricated by a pending timer.
      await page.waitForTimeout(3200)
      expect(await countWordRecords(page)).toBe(before + 1)
      await expect(taskView.locator('[data-mobile-manual-next]')).toBeVisible()
      return
    }

    if (task === 'exposure') {
      await taskView.getByRole('button', { name: '继续学习' }).click()
    } else {
      const choices = taskView.locator('[data-mobile-choice]')
      await expect(choices.first()).toBeEnabled({ timeout: 15_000 })
      const target = await taskView.getAttribute('data-mobile-word')
      const labels = await choices.allTextContents()
      const index = task === 'meaning-choice' ? 0 : labels.findIndex(label => label.trim() === target)
      await choices.nth(Math.max(0, index)).click()
    }
    await expect(taskView.locator('[data-mobile-feedback]')).toBeVisible({ timeout: 15_000 })
    if (await taskView.getAttribute('data-mobile-next-mode') === 'manual') {
      await taskView.locator('[data-mobile-manual-next]').click()
    }
    await expect(taskView.locator('[data-mobile-feedback]')).toHaveCount(0, { timeout: 7_000 })
  }
  throw new Error('No recall task reached within 36 scheduled tasks')
})


async function readWordLearningEvidence(page: Page, word: string) {
  return page.evaluate(async (name) => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const tx = db.transaction(['wordRecords', 'reviewWordStates'], 'readonly')
      const [records, states] = await Promise.all([
        new Promise<Array<{
          word: string; sourceMode?: string; learnItemKind?: string; wrongCount: number
          reviewPolicyDecision?: { policyVersion: string; reasonCodes: string[] }
          reviewEvidence?: { reasonCodes: string[] }
        }>>((resolve, reject) => {
          const req = tx.objectStore('wordRecords').getAll()
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        }),
        new Promise<Array<{
          dict: string; word: string; lifecycle?: string; schedulerState?: { kind: string }
        }>>((resolve, reject) => {
          const req = tx.objectStore('reviewWordStates').getAll()
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        }),
      ])
      return {
        records: records.filter((row) => row.word === name && row.sourceMode === 'learn'),
        state: states.find((row) => row.dict === 'cet4' && row.word === name) ?? null,
      }
    } finally { db.close() }
  }, word)
}

test('Phone-only Independent Good admits a new word into the same durable FSRS state as desktop', async ({ page }) => {
  await mockWordPronunciation(page)
  await seedAcquisitionSession(page, reviewWords, 930001, 'independent', 4)
  await page.goto('/mobile/study')
  const practice = page.locator('[data-mobile-word-practice]')
  await expect(practice).toBeVisible({ timeout: 45_000 })
  await expect(practice).toHaveAttribute('data-mobile-task', 'recall')
  await expect(practice).toHaveAttribute('data-mobile-policy', 'learn-acquisition-independent-v1')
  const word = (await practice.getAttribute('data-mobile-word'))!
  const before = await readWordLearningEvidence(page, word)
  expect(before.state).toBeNull()
  expect(before.records).toHaveLength(0)

  await practice.locator('[data-mobile-grade="good"]').click()
  await expect(practice.locator('[data-mobile-answer-revealed]')).toBeVisible()
  await expect(practice).toHaveAttribute('data-mobile-recall-stage', 'verification')
  // No synthetic Good may be written until the answer-check window closes.
  expect((await readWordLearningEvidence(page, word)).records).toHaveLength(0)
  await expect.poll(async () => (await readWordLearningEvidence(page, word)).records.length,
    { timeout: 12_000 }).toBe(1)
  await expect.poll(async () => (await readWordLearningEvidence(page, word)).state?.lifecycle,
    { timeout: 12_000 }).toBe('active')
  const after = await readWordLearningEvidence(page, word)
  expect(after.state?.schedulerState?.kind).toBe('fsrs6')
  expect(after.records[0].learnItemKind).toBe('acquisition')
  expect(after.records[0].reviewPolicyDecision?.policyVersion).toBe('learn-acquisition-independent-v1')
  expect(after.records[0].reviewPolicyDecision?.reasonCodes).toContain('spacing-eligible')
  expect(after.records[0].reviewEvidence?.reasonCodes).toContain('self-rated-before-answer-reveal')
  expect(after.records[0].reviewEvidence?.reasonCodes).toContain('self-report-not-spelling')
})

test('Phone-only uncertain Independent recall does not falsely admit a new word', async ({ page }) => {
  await mockWordPronunciation(page)
  await seedAcquisitionSession(page, reviewWords, 930002, 'independent', 4)
  await page.goto('/mobile/study')
  const practice = page.locator('[data-mobile-word-practice]')
  await expect(practice).toBeVisible({ timeout: 45_000 })
  await expect(practice).toHaveAttribute('data-mobile-task', 'recall')
  const word = (await practice.getAttribute('data-mobile-word'))!
  await practice.locator('[data-mobile-grade="hard"]').click()
  await expect(practice.locator('[data-mobile-feedback]')).toBeVisible()
  await page.waitForTimeout(500)
  const after = await readWordLearningEvidence(page, word)
  expect(after.records).toHaveLength(1)
  expect(after.records[0].wrongCount).toBe(0)
  expect(after.state).toBeNull()
  await expect(practice.locator('[data-mobile-manual-next]')).toBeVisible()
})


test('Phone-only cold spelling validates correct orthography without a second FSRS engine', async ({ page }) => {
  await mockWordPronunciation(page)
  await seedAcquisitionSession(page, reviewWords, 930003, 'independent', 4)
  await page.goto('/mobile/study')
  const practice = page.locator('[data-mobile-word-practice]')
  await expect(practice).toBeVisible({ timeout: 45_000 })
  const word = (await practice.getAttribute('data-mobile-word'))!
  await expect(practice).toHaveAttribute('data-mobile-task', 'recall')
  await expect(practice.locator('input')).toHaveCount(0)
  await practice.locator('[data-mobile-interaction-toggle]').click()
  await expect(practice).toHaveAttribute('data-mobile-task', 'spelling')
  await expect(practice.locator('[data-mobile-answer-revealed]')).toHaveCount(0)
  await expect(practice.locator('.mobile-practice-word')).toHaveCount(0)
  const input = practice.getByRole('textbox', { name: '独立拼写单词' })
  await expect(input).toBeVisible()
  await input.fill(word)
  await practice.getByRole('button', { name: '确认拼写' }).click()
  await expect.poll(async () => (await readWordLearningEvidence(page, word)).records.length,
    { timeout: 12_000 }).toBe(1)
  const evidence = (await readWordLearningEvidence(page, word)).records[0]
  expect(evidence.reviewPolicyDecision?.policyVersion).toBe('learn-acquisition-independent-v1')
  expect(evidence.reviewPolicyDecision?.reasonCodes).toContain('spacing-eligible')
  await expect.poll(async () => (await readWordLearningEvidence(page, word)).state?.lifecycle,
    { timeout: 12_000 }).toBe('active')
  const saved = await readWordLearningEvidence(page, word)
  expect(saved.records).toHaveLength(1)
  expect(saved.records[0].reviewEvidence?.reasonCodes).toContain('objective-spelling-clean')
  expect(saved.records[0].reviewEvidence?.reasonCodes).not.toContain('self-report-not-spelling')
})

test('Desktop Learn switches between keyboard spelling and the same Tap Recall without changing the session', async ({ page }) => {
  // The mobile E2E suite defaults to 390px. A desktop-specific path must
  // run with a desktop viewport, otherwise the responsive app redirects.
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockWordPronunciation(page)
  await page.goto('/learn')
  // Use the real desktop entry rather than a seeded cross-route fixture:
  // both interfaces must operate inside an actual Learn daily session.
  const start = page.getByRole('button', { name: '开始 Learn', exact: true })
  await expect(start).toBeVisible({ timeout: 45_000 })
  await expect(start).toBeEnabled({ timeout: 45_000 })
  await start.click()
  await expect(page.getByRole('button', { name: '学习方式：拼写', exact: true })).toBeVisible({ timeout: 45_000 })
  // The switcher is already visible on the landing page; wait for the real
  // session to finish preparing before capturing its identity.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('reviewModeInfo') || '{}').reviewRecord?.id), { timeout: 45_000 }).toBeDefined()
  const beforeId = await page.evaluate(() => JSON.parse(localStorage.getItem('reviewModeInfo') || '{}').reviewRecord?.id)
  await page.getByRole('button', { name: '学习方式：拼写', exact: true }).click()
  const tap = page.locator('[data-desktop-tap-study]')
  await expect(tap).toBeVisible()
  const practice = tap.locator('[data-mobile-word-practice]')
  await expect(practice).toBeVisible()
  await expect(practice).toHaveAttribute('data-mobile-task', /^(recall|exposure|context|audio|meaning-choice)$/)
  await page.getByRole('button', { name: '学习方式：轻触', exact: true }).click()
  await expect(page.locator('[data-desktop-tap-study]')).toHaveCount(0)
  await expect(page.locator('[data-typing-word]').first()).toBeVisible()
  const afterId = await page.evaluate(() => JSON.parse(localStorage.getItem('reviewModeInfo') || '{}').reviewRecord?.id)
  expect(afterId).toBe(beforeId)
})


test('Unified selector keeps cold memory eligibility while recommending spelling from real past evidence', () => {
  const base = {
    itemKind: 'review' as const,
    hasContext: true,
    choicesAvailable: true,
    audioAvailable: true,
    goal: 'vocabulary-and-spelling' as const,
    preference: 'auto' as const,
    hasTextInput: true,
  }
  const successfulRecall = (timeStamp: number) => ({
    timeStamp,
    learnItemKind: 'review',
    reviewRatingDecision: { eligible: true, rating: 'good' },
    reviewEvidence: {
      errorCause: 'clean',
      reasonCodes: ['self-rated-before-answer-reveal', 'self-report-not-spelling'],
    },
  })
  const positive = [successfulRecall(1), successfulRecall(2), successfulRecall(3)]
  expect(selectLearnTask({ ...base, history: positive }).exercise).toBe('spelling')
  expect(selectLearnTask({ ...base, history: positive }).reason).toBe('spelling-verification-due')
  expect(selectLearnTask({ ...base, history: positive, goal: 'vocabulary' }).exercise).toBe('recall')
  expect(selectLearnTask({ ...base, history: positive, preference: 'tap-recall' }).exercise).toBe('recall')
  expect(selectLearnTask({ ...base, history: positive, hasTextInput: false }).exercise).toBe('recall')
  expect(selectLearnTask({ ...base, history: positive, itemKind: 'acquisition', acquisitionPhase: 'exposure' }).exercise).toBe('exposure')
  expect(selectLearnTask({ ...base, history: positive, itemKind: 'acquisition', acquisitionPhase: 'guided' }).exercise).toBe('context')
  expect(selectLearnTask({ ...base, history: positive, itemKind: 'acquisition', acquisitionPhase: 'guided', choicesAvailable: false }).exercise).toBe('recall')
  expect(selectLearnTask({ ...base, history: positive, itemKind: 'acquisition', acquisitionPhase: 'supported', choicesAvailable: false }).exercise).toBe('recall')

  const recognized = { timeStamp: 4, learnItemKind: 'acquisition',
    reviewRatingDecision: { eligible: false, rating: null },
    reviewEvidence: { errorCause: 'clean', reasonCodes: ['recognition-or-training-evidence'] } }
  expect(selectLearnTask({ ...base, history: [recognized, recognized, recognized] }).exercise).toBe('recall')
  const verified = { timeStamp: 5, learnItemKind: 'review',
    reviewRatingDecision: { eligible: true, rating: 'good' },
    reviewEvidence: { errorCause: 'clean', reasonCodes: ['objective-spelling-clean'] } }
  expect(selectLearnTask({ ...base, history: [...positive, verified] }).exercise).toBe('recall')
  const misspelled = { timeStamp: 6, learnItemKind: 'review',
    reviewRatingDecision: { eligible: true, rating: 'hard' },
    reviewEvidence: { errorCause: 'spelling', reasonCodes: ['objective-spelling-mismatch'] } }
  expect(selectLearnTask({ ...base, history: [misspelled] }).exercise).toBe('spelling')
  expect(selectLearnTask({ ...base, history: [misspelled, { ...verified, timeStamp: 7 }] }).exercise).toBe('recall')
  expect(selectLearnTask({ ...base, history: positive, preference: 'cold-spelling' }).exercise).toBe('spelling')
  expect(selectLearnTask({ ...base, history: positive, itemKind: 'practice' }).exercise).toBe('recall')
})

test('Phone spelling mismatch distinguishes remembered typo from recall failure before revealing answer', async ({ page }) => {
  await mockWordPronunciation(page)
  await seedAcquisitionSession(page, reviewWords, 930005, 'independent', 4)
  await page.goto('/mobile/study')
  const practice = page.locator('[data-mobile-word-practice]')
  await expect(practice).toBeVisible({ timeout: 45_000 })
  const word = (await practice.getAttribute('data-mobile-word'))!
  await practice.locator('[data-mobile-interaction-toggle]').click()
  await expect(practice).toHaveAttribute('data-mobile-task', 'spelling')
  const input = practice.getByRole('textbox', { name: '独立拼写单词' })
  await input.fill(word + 'x')
  await practice.getByRole('button', { name: '确认拼写' }).click()
  await expect(practice.locator('[data-mobile-spelling-judgment]')).toBeVisible()
  await expect(practice.locator('[data-mobile-answer-revealed]')).toHaveCount(0)
  expect((await readWordLearningEvidence(page, word)).records).toHaveLength(0)
  await practice.locator('[data-mobile-spelling-cause="spelling"]').click()
  await expect(practice.locator('[data-mobile-feedback]')).toBeVisible()
  const saved = await readWordLearningEvidence(page, word)
  expect(saved.records).toHaveLength(1)
  expect(saved.records[0].wrongCount).toBe(1)
  expect(saved.records[0].reviewEvidence?.reasonCodes).toContain('learner-confirmed-recalled-but-misspelled')
  expect(saved.records[0].reviewEvidence?.reasonCodes).toContain('objective-spelling-mismatch')
  expect(saved.records[0].reviewEvidence?.reasonCodes).not.toContain('self-report-not-spelling')
  expect(saved.state).toBeNull()
  await expect(practice.locator('[data-mobile-manual-next]')).toBeVisible()
})

test('Phone spelling mismatch can be explicitly adjudicated as real memory failure', async ({ page }) => {
  await mockWordPronunciation(page)
  await seedAcquisitionSession(page, reviewWords, 930006, 'independent', 4)
  await page.goto('/mobile/study')
  const practice = page.locator('[data-mobile-word-practice]')
  await expect(practice).toBeVisible({ timeout: 45_000 })
  const word = (await practice.getAttribute('data-mobile-word'))!
  await practice.locator('[data-mobile-interaction-toggle]').click()
  await practice.getByRole('textbox', { name: '独立拼写单词' }).fill(word + 'x')
  await practice.getByRole('button', { name: '确认拼写' }).click()
  await practice.locator('[data-mobile-spelling-cause="recall"]').click()
  await expect(practice.locator('[data-mobile-feedback]')).toBeVisible()
  const saved = await readWordLearningEvidence(page, word)
  expect(saved.records).toHaveLength(1)
  expect(saved.records[0].wrongCount).toBe(1)
  expect(saved.records[0].reviewEvidence?.reasonCodes).not.toContain('learner-confirmed-recalled-but-misspelled')
  expect(saved.state).toBeNull()
})
