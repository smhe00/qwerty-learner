import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { buildContextChoices, buildShortMeaningChoices, getShortMeaning } from '../../src/learn/choices'
import { selectLearnTask } from '../../src/learn/task-selector'
import type { Word } from '../../src/typings'
import { readReviewModeInfo, reviewWords, seedAcquisitionSession } from './review-flow-harness'

const words = reviewWords.map(word => ({
  ...word,
  trans: [...word.trans, '这是原始完整释义中的拓展说明，选择题不应把这一整段放入选项。'],
}))
const surfaces = [
  { name: 'phone', route: '/mobile/study', width: 390, height: 844 },
  { name: 'tablet', route: '/mobile/study', width: 1024, height: 600 },
  { name: 'desktop', route: '/learn', width: 1440, height: 900 },
] as const

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

async function open(
  page: Page,
  surface: typeof surfaces[number],
  seededWords: Word[],
  phase: 'guided' | 'supported',
  blocked = false,
) {
  await page.setViewportSize({ width: surface.width, height: surface.height })
  await page.route('**/dictvoice?**', route => route.fulfill({
    contentType: 'audio/mpeg', body: readFileSync('public/sounds/key-sound/Alpacas.mp3'),
  }))
  await page.addInitScript((deny) => {
    localStorage.setItem('learnInputMode', 'touch')
    ;(window as any).__shortMeaningAudioCalls = 0
    HTMLMediaElement.prototype.play = function () {
      ;(window as any).__shortMeaningAudioCalls++
      if (deny) return Promise.reject(new DOMException('blocked', 'NotAllowedError'))
      this.dispatchEvent(new Event('playing'))
      return Promise.resolve()
    }
  }, blocked)
  await seedAcquisitionSession(page, seededWords, 983100, phase)
  await page.goto(surface.route)
  const card = page.locator('[data-mobile-word-practice]')
  await expect(card).toBeVisible({ timeout: 30000 })
  if (await card.locator('[data-mobile-paused]').isVisible()) {
    await card.locator('[data-mobile-paused]').getByRole('button', { name: /继续学习/ }).click()
  }
  await expect(card).toHaveAttribute('data-mobile-word', seededWords[0].name)
  return card
}

test('short gloss pools exclude absent, blank, malformed and overlapping options without mutating source', () => {
  const word = (name: string, shortMeaning?: string): Word => ({ name, shortMeaning, trans: ['完整释义'], usphone: '', ukphone: '' })
  const target = word('target', '取消；撤销')
  const pool = [target, word('same', ' 取消 ; 撤销 '), word('overlap', '撤销；收回'),
    word('missing'), word('empty', ''), word('spaces', ' \n '), word('punctuation', '；'),
    word('analysis', '分析'), word('analysis-copy', ' 分析 '), word('abundant', '众多的'),
    word('confirm', '确认'), word('confirm', '肯定')]
  const before = JSON.stringify(pool)
  const choices = buildShortMeaningChoices(target, pool)
  expect(choices).toHaveLength(4)
  expect(choices).toContain(target)
  for (const name of ['same', 'overlap', 'missing', 'empty', 'spaces', 'punctuation']) {
    expect(choices.map(item => item.name)).not.toContain(name)
  }
  expect(choices.filter(item => getShortMeaning(item) === '分析')).toHaveLength(1)
  expect(new Set(choices.map(item => item.name)).size).toBe(choices.length)
  expect(buildShortMeaningChoices(target, [...pool].reverse()).map(item => item.name).sort()).toEqual(choices.map(item => item.name).sort())
  expect(JSON.stringify(pool)).toBe(before)
  expect(buildShortMeaningChoices(target, [word('same', '取消')])).toEqual([])
  for (const value of [undefined, '', ' \n ', null, 123]) {
    expect(buildShortMeaningChoices({ ...target, shortMeaning: value } as Word, pool)).toEqual([])
  }
  expect(buildContextChoices(word('no-short'), pool).length).toBeGreaterThan(1)
})

test('selector gates both meaning exercises independently of context and preserves cold probes', () => {
  const base = { itemKind: 'acquisition' as const, choicesAvailable: true, meaningChoicesAvailable: false,
    hasContext: false, audioAvailable: true, goal: 'vocabulary-and-spelling' as const,
    preference: 'auto' as const, hasTextInput: true }
  for (const acquisitionPhase of ['guided', 'supported']) {
    for (const audioAvailable of [false, true]) {
      expect(selectLearnTask({ ...base, acquisitionPhase, audioAvailable }).exercise).toBe('recall')
    }
  }
  expect(selectLearnTask({ ...base, acquisitionPhase: 'guided', hasContext: true }).exercise).toBe('context')
  expect(selectLearnTask({ ...base, acquisitionPhase: 'guided', meaningChoicesAvailable: true }).exercise).toBe('meaning-choice')
  expect(selectLearnTask({ ...base, acquisitionPhase: 'supported', meaningChoicesAvailable: true }).exercise).toBe('audio')
  expect(selectLearnTask({ ...base, acquisitionPhase: 'supported', meaningChoicesAvailable: true, audioAvailable: false }).exercise).toBe('meaning-choice')
  expect(selectLearnTask({ ...base, acquisitionPhase: 'exposure' }).exercise).toBe('exposure')
  expect(selectLearnTask({ ...base, acquisitionPhase: 'independent', meaningChoicesAvailable: true }).exercise).toBe('recall')
  expect(selectLearnTask({ ...base, itemKind: 'review', preference: 'cold-spelling', meaningChoicesAvailable: true }).exercise).toBe('spelling')
})

for (const surface of surfaces) {
  for (const [label, shortMeaning] of [['missing', undefined], ['empty', ''], ['whitespace', ' \n ']] as const) {
    test(`${surface.name} ${label} short meaning skips listening even after refresh`, async ({ page }) => {
      const seeded = [{ ...words[0], shortMeaning }, ...words.slice(1)]
      const card = await open(page, surface, seeded, 'supported')
      await expect(card).toHaveAttribute('data-mobile-task', 'recall')
      await expect(card.locator('[data-mobile-choice]')).toHaveCount(0)
      expect(await records(page)).toHaveLength(0)
      await page.reload()
      await expect(card).toHaveAttribute('data-mobile-task', 'recall')
      expect(await page.evaluate(() => (window as any).__shortMeaningAudioCalls)).toBe(0)
      expect(await records(page)).toHaveLength(0)
      if (await card.locator('[data-mobile-paused]').isVisible()) {
        await card.locator('[data-mobile-paused]').getByRole('button', { name: /继续学习/ }).click()
      }
      await card.locator('[data-mobile-grade="hard"]').click()
      await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
      expect(await records(page)).toHaveLength(1)
      expect((await records(page))[0].reviewEvidence.reasonCodes).toContain('mobile-task-recall')
    })
  }

  for (const phase of ['guided', 'supported'] as const) {
    test(`${surface.name} ${phase} uses short choices and preserves them after completion`, async ({ page }) => {
      const card = await open(page, surface, words, phase)
      const task = phase === 'guided' ? 'meaning-choice' : 'audio'
      await expect(card).toHaveAttribute('data-mobile-task', task)
      const choices = card.locator('[data-mobile-choice]')
      await expect(choices).toHaveCount(3)
      const labels = await choices.evaluateAll(buttons => buttons.map(button =>
        Array.from(button.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()))
      expect(labels.sort()).toEqual(words.map(word => word.shortMeaning!).sort())
      if (phase === 'supported') {
        await expect(card.getByRole('heading', { name: '听音选义' })).toBeVisible()
        await expect(card.locator('.mobile-practice-word')).toHaveCount(0)
      }
      expect(await records(page)).toHaveLength(0)
      // Wrong answer keeps the complete explanation on screen for inspection.
      await choices.filter({ hasText: words[1].shortMeaning! }).click()
      await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
      await expect(card.locator('.mobile-practice-meaning')).toHaveText(words[0].trans.join('；'))
      const saved = await records(page)
      expect(saved).toHaveLength(1)
      expect(saved[0].reviewEvidence.reasonCodes).toContain('mobile-task-' + task)
      expect(saved[0].reviewEvidence.retrievalValidity).toBe('assisted')
      if (phase === 'supported') {
        expect(saved[0].exerciseCondition).toMatchObject({ meaning: 'visible', letters: { mode: 'all-hidden' } })
        expect(saved[0].learningContext).toMatchObject({ answerVisibilityAtStart: 'hidden', meaningVisibleAtStart: true, pronunciationPlayed: true })
      }
      await card.locator('[data-mobile-manual-next]').click()
      await expect(card.locator('[data-mobile-feedback]')).toHaveCount(0)
      const after = (await readReviewModeInfo(page)).reviewRecord.words
      expect(after.length).toBeGreaterThan(0)
      for (const word of after) expect(word.shortMeaning).toBe(words.find(item => item.name === word.name)!.shortMeaning)
      expect(await records(page)).toHaveLength(1)
    })
  }

  test(`${surface.name} blocked audio falls back to short meaning without a phantom attempt`, async ({ page }) => {
    const card = await open(page, surface, words, 'supported', true)
    await expect(card).toHaveAttribute('data-mobile-task', 'audio')
    await card.getByRole('button', { name: '先练词义', exact: true }).click()
    await expect(card).toHaveAttribute('data-mobile-task', 'meaning-choice')
    await expect(card.locator('[data-mobile-choice]')).toHaveCount(3)
    expect(await records(page)).toHaveLength(0)
    await card.locator('[data-mobile-choice]').filter({ hasText: words[1].shortMeaning! }).click()
    await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
    const saved = await records(page)
    expect(saved).toHaveLength(1)
    expect(saved[0].reviewEvidence.reasonCodes).toContain('mobile-task-meaning-choice')
    expect(saved[0].learningContext.pronunciationPlayed).toBe(false)
  })
}

test('missing short gloss skips word-to-meaning and sparse pools cannot fall back to long definitions', async ({ page }) => {
  const noShort = words.map(word => ({ ...word, shortMeaning: undefined }))
  const card = await open(page, surfaces[0], noShort, 'guided')
  await expect(card).toHaveAttribute('data-mobile-task', 'recall')
  await expect(card.locator('[data-mobile-choice]')).toHaveCount(0)
  expect(await records(page)).toHaveLength(0)
})

test('valid target without distinct eligible distractors uses recall', async ({ page }) => {
  const sparse = [words[0], { ...words[1], shortMeaning: '' }, { ...words[2], shortMeaning: '取消；撤销' }]
  const card = await open(page, surfaces[1], sparse, 'supported')
  await expect(card).toHaveAttribute('data-mobile-task', 'recall')
  await expect(card.locator('[data-mobile-choice]')).toHaveCount(0)
  expect(await records(page)).toHaveLength(0)
})

test('context cloze stays available without short meanings and keeps English options', async ({ page }) => {
  const cloze = words.map(word => ({ ...word, shortMeaning: undefined }))
  cloze[0] = { ...cloze[0], example: [{ en: 'Please cancel it.', cn: '请取消它。', start: 7, end: 13 }] }
  const card = await open(page, surfaces[2], cloze, 'guided')
  await expect(card).toHaveAttribute('data-mobile-task', 'context')
  const labels = await card.locator('[data-mobile-choice]').evaluateAll(buttons => buttons.map(button =>
    Array.from(button.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()))
  expect(labels.sort()).toEqual(words.map(word => word.name).sort())
  expect(await records(page)).toHaveLength(0)
})
