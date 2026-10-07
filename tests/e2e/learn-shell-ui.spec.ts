import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  parseDiagnosticExport,
  replayDiagnostic,
} from '../../src/dev/replay'
import {
  readReviewModeInfo,
  reviewWords,
  seedReviewAdmissionCase,
  seedReviewSession,
  startTyping,
  waitForActiveLearnSession,
  waitForRenderedWord,
} from './review-flow-harness'

test('Typing and Learn are explicit top-level modes', async ({ page }) => {
  await page.goto('/typing')

  const typingMode = page.getByRole('button', { name: 'Typing', exact: true })
  const learnMode = page.getByRole('button', { name: 'Learn', exact: true })

  await expect(typingMode).toHaveAttribute('aria-pressed', 'true')
  await expect(learnMode).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: '开始' })).toBeVisible()

  await learnMode.click()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.getByRole('button', { name: 'Learn', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: '开始', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('按任意键开始')).toBeVisible()
  await startTyping(page)
  await expect(
    page.getByRole('button', { name: '暂停', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('今日到期', { exact: true })).toHaveCount(0)
  await expect(page.getByText('学习计划', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Typing', exact: true }).click()
  await expect(page).toHaveURL(/\/typing$/)
  await expect(
    page.getByRole('button', { name: 'Typing', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('Learn entry keeps long-term state while plan details stay hidden', async ({
  page,
}) => {
  await seedReviewAdmissionCase(page, {
    freshLearningAfterReview: false,
  })

  await page.goto('/learn')
  await expect(page).toHaveURL(/\/learn$/)
  await expect(page.getByText('长期学习中', { exact: true })).toHaveCount(0)
  await expect(page.getByText('学习计划', { exact: true })).toHaveCount(0)

  const state = await page.evaluate(async () => {
    return new Promise<{
      lifecycle?: string
      reviewCount?: number
      nextReviewAt?: number
    } | null>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewWordStates', 'readonly')
        const all = tx.objectStore('reviewWordStates').getAll()
        all.onerror = () => reject(all.error)
        all.onsuccess = () => {
          const match = all.result.find(
            (item) => item.dict === 'cet4' && item.word === 'cancel',
          )
          resolve(
            match
              ? {
                  lifecycle: match.lifecycle,
                  reviewCount: match.reviewCount,
                  nextReviewAt: match.nextReviewAt,
                }
              : null,
          )
          db.close()
        }
      }
    })
  })

  expect(state).toMatchObject({
    reviewCount: 1,
  })
  expect(state?.lifecycle ?? 'active').toBe('active')
})

test('current Learn item can be excluded without using Skip', async ({ page }) => {
  await seedReviewSession(page, reviewWords.slice(0, 2), 900020)
  await page.goto('/learn')
  await startTyping(page)
  await waitForRenderedWord(page, 'cancel')

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('移出学习计划')
    await dialog.accept()
  })

  await page.getByRole('button', { name: 'Learn 单词菜单' }).click()
  await page.getByRole('button', { name: '移出学习计划' }).click()

  await expect
    .poll(async () => {
      const info = await readReviewModeInfo(page)
      return {
        words: info?.reviewRecord?.words?.map(
          (word: { name: string }) => word.name,
        ),
        index: info?.reviewRecord?.index,
        isFinished: info?.reviewRecord?.isFinished,
      }
    })
    .toEqual({
      words: ['analyse'],
      index: 0,
      isFinished: false,
    })
  await expect(page.getByText('CET-4 Learn', { exact: true })).toHaveCount(0)
  await waitForRenderedWord(page, 'analyse')
  await expect(
    page.locator('[data-typing-word="cancel"]'),
  ).toHaveCount(0)

  const state = await page.evaluate(async () => {
    return new Promise<{ lifecycle?: string } | null>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('reviewWordStates', 'readonly')
        const all = tx.objectStore('reviewWordStates').getAll()
        all.onerror = () => reject(all.error)
        all.onsuccess = () => {
          const match = all.result.find(
            (item) => item.dict === 'cet4' && item.word === 'cancel',
          )
          resolve(match ? { lifecycle: match.lifecycle } : null)
          db.close()
        }
      }
    })
  })

  expect(state?.lifecycle).toBe('excluded')
})

test('Learn dictionary selection reuses the Typing gallery and skips chapter selection', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
  })

  await page.goto('/learn')
  await waitForActiveLearnSession(page)
  await page.getByRole('link', { name: 'CET-4', exact: true }).click()
  await expect(page).toHaveURL(/\/gallery\?mode=learn$/)

  const target = page
    .getByRole('button', {
      name: /^选择 Learn 词库：/,
    })
    .first()
  await expect(target).toBeVisible()

  const targetLabel = await target.getAttribute('aria-label')
  expect(targetLabel).toMatch(/^选择 Learn 词库：.+/)
  const selectedDictionaryName = targetLabel?.replace(
    /^选择 Learn 词库：/,
    '',
  )
  expect(selectedDictionaryName).toBeTruthy()

  await target.click()

  await expect(page).toHaveURL(/\/learn$/)
  await expect(
    page.getByRole('link', {
      name: selectedDictionaryName as string,
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByText('章节选择', { exact: true })).toHaveCount(0)
})

test('developer diagnostics exports a read-only incident bundle from the UI', async ({
  page,
}) => {
  await page.goto('/typing')
  await page.getByTitle('打开设置对话框').click()
  await page.getByRole('tab', { name: '开发诊断', exact: true }).click()

  const downloadPromise = page.waitForEvent('download')
  await page
    .getByRole('button', { name: '导出现场诊断包', exact: true })
    .click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(
    /^Qwerty-Plus-Incident-.*\.json$/,
  )
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const exported = await readFile(downloadPath as string, 'utf8')
  const parsed = parseDiagnosticExport(exported)
  expect(parsed.kind).toBe('incident')
  expect(parsed.schema).toBe('qwerty-developer-incident-v1')
  const replay = replayDiagnostic(parsed)
  expect(replay.eventCount).toBeGreaterThanOrEqual(0)

  await expect(
    page.getByText('现场诊断包已导出。请直接把该 JSON 文件发给开发者。'),
  ).toBeVisible()

  // Export is read-only: the current route and Learn/Typing ownership do not
  // change merely because diagnostics were captured.
  await expect(page).toHaveURL(/\/typing$/)
})

test('Learn header keeps dictionary, Start, and Settings aligned with Typing', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({ isReviewMode: false }),
    )
  })

  await page.goto('/typing')
  const typingDictionary = page.getByRole('link', {
    name: 'CET-4',
    exact: true,
  })
  const typingStart = page.getByRole('button', {
    name: '开始',
    exact: true,
  })
  const typingSetting = page.getByTitle('打开设置对话框')

  await expect(typingDictionary).toBeVisible()
  await expect(typingStart).toBeVisible()
  await expect(typingSetting).toBeVisible()

  const typingPositions = {
    dictionary: (await typingDictionary.boundingBox())?.x ?? 0,
    start: (await typingStart.boundingBox())?.x ?? 0,
    setting: (await typingSetting.boundingBox())?.x ?? 0,
  }

  await page.goto('/learn')
  await expect(page).toHaveURL(/\/learn$/)
  const learnDictionary = page.getByRole('link', {
    name: 'CET-4',
    exact: true,
  })
  const learnStart = page.getByRole('button', {
    name: '开始',
    exact: true,
  })
  const learnSetting = page.getByTitle('打开设置对话框')

  await expect(learnDictionary).toBeVisible()
  await expect(learnStart).toBeVisible()
  await expect(learnSetting).toBeVisible()

  const learnPositions = {
    dictionary: (await learnDictionary.boundingBox())?.x ?? 0,
    start: (await learnStart.boundingBox())?.x ?? 0,
    setting: (await learnSetting.boundingBox())?.x ?? 0,
  }

  expect(
    Math.abs(learnPositions.dictionary - typingPositions.dictionary),
  ).toBeLessThanOrEqual(4)
  expect(
    Math.abs(learnPositions.start - typingPositions.start),
  ).toBeLessThanOrEqual(24)
  expect(
    Math.abs(learnPositions.setting - typingPositions.setting),
  ).toBeLessThanOrEqual(24)

  await expect(page.getByText('今日到期', { exact: true })).toHaveCount(0)
  await expect(page.getByText('学习计划', { exact: true })).toHaveCount(0)
})

test('Learn reuses Typing controls while preserving Typing-owned preferences', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(2))
    localStorage.setItem(
      'loopWordConfig',
      JSON.stringify({ times: 3 }),
    )
    localStorage.setItem(
      'wordDictationConfig',
      JSON.stringify({
        isOpen: true,
        type: 'hideVowel',
        openBy: 'user',
      }),
    )
    localStorage.setItem(
      'typingTransVisible',
      JSON.stringify(false),
    )
    localStorage.setItem(
      'pronunciation',
      JSON.stringify({
        isOpen: true,
        volume: 1,
        type: 'uk',
        name: '英音',
        isLoop: false,
        isTransRead: false,
        transVolume: 1,
        rate: 1,
      }),
    )
    localStorage.setItem(
      'phoneticConfig',
      JSON.stringify({ isOpen: true, type: 'uk' }),
    )
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({ isReviewMode: false }),
    )

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const names = [
          'wordRecords',
          'reviewWordStates',
          'reviewRecords',
        ]
        const tx = db.transaction(names, 'readwrite')
        for (const name of names) {
          tx.objectStore(name).clear()
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }
    })
  })

  await page.goto('/typing')
  await expect(
    page.getByRole('button', { name: '第 3 章', exact: true }),
  ).toBeVisible()

  const before = await page.evaluate(() => ({
    chapter: localStorage.getItem('currentChapter'),
    loop: localStorage.getItem('loopWordConfig'),
    dictation: localStorage.getItem('wordDictationConfig'),
    trans: localStorage.getItem('typingTransVisible'),
    pronunciation: localStorage.getItem('pronunciation'),
    phonetic: localStorage.getItem('phoneticConfig'),
  }))

  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)

  await expect(
    page.getByRole('button', {
      name: '章节切换（Learn 模式禁用）',
      exact: true,
    }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', {
      name: '选择单词的循环次数',
      exact: true,
    }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', {
      name: '开关默写模式',
      exact: true,
    }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', {
      name: /开关释义显示/,
    }),
  ).toBeDisabled()

  const analysisButton = page.getByRole('button', {
    name: '查看数据统计',
    exact: true,
  })
  await expect(analysisButton).toBeEnabled()
  await expect(
    page.getByRole('button', {
      name: '错题本（Learn 模式禁用）',
      exact: true,
    }),
  ).toBeDisabled()

  const sessionBeforeAnalysis = await readReviewModeInfo(page)
  await analysisButton.click()
  await expect(page).toHaveURL(/\/analysis\?from=learn$/)
  await expect(
    page.getByRole('heading', { name: 'Learn 数据统计', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('当前到期', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('30日复习通过率', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(page.getByText('按任意键开始')).toBeVisible()
  const sessionAfterAnalysis = await readReviewModeInfo(page)
  expect(
    sessionAfterAnalysis?.reviewRecord?.id ??
      sessionAfterAnalysis?.reviewRecord?.createTime,
  ).toBe(
    sessionBeforeAnalysis?.reviewRecord?.id ??
      sessionBeforeAnalysis?.reviewRecord?.createTime,
  )

  const pronunciationButton = page.getByRole('button', {
    name: '发音口音：英音',
    exact: true,
  })
  await expect(pronunciationButton).toBeEnabled()
  await pronunciationButton.click()
  await expect(
    page.getByText('单词发音口音', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  const soundButton = page.getByRole('button', {
    name: '音效设置',
    exact: true,
  })
  await expect(soundButton).toBeEnabled()
  await soundButton.click()
  await expect(
    page.getByText('开关按键音', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  const afterLanding = await page.evaluate(() => ({
    chapter: localStorage.getItem('currentChapter'),
    loop: localStorage.getItem('loopWordConfig'),
    dictation: localStorage.getItem('wordDictationConfig'),
    trans: localStorage.getItem('typingTransVisible'),
    pronunciation: localStorage.getItem('pronunciation'),
    phonetic: localStorage.getItem('phoneticConfig'),
  }))
  expect(afterLanding).toEqual(before)

  expect(
    await page.evaluate(() =>
      localStorage.getItem('currentChapter'),
    ),
  ).toBe(before.chapter)

  const info = await readReviewModeInfo(page)
  const firstWord = info?.reviewRecord?.words?.[0]?.name as string
  await startTyping(page)
  await waitForRenderedWord(page, firstWord)
  const rendered = page.locator(
    `[data-typing-word="${firstWord}"]`,
  )
  // Learn owns acquisition presentation. Typing preferences remain stored,
  // but first exposure deliberately shows the answer/phonetic and plays audio.
  await expect(rendered).toHaveAttribute('data-review-audio', 'automatic')
  await expect(rendered).toHaveAttribute(
    'data-review-letters',
    'all-visible',
  )
  await expect(rendered).toHaveAttribute(
    'data-review-phonetic',
    'visible',
  )
  await expect(rendered).toHaveAttribute(
    'data-review-meaning',
    'visible',
  )

  await page.getByRole('button', { name: 'Typing', exact: true }).click()
  await expect(page).toHaveURL(/\/typing$/)
  await expect(
    page.getByRole('button', { name: '第 3 章', exact: true }),
  ).toBeVisible()

  const afterReturn = await page.evaluate(() => ({
    chapter: localStorage.getItem('currentChapter'),
    loop: localStorage.getItem('loopWordConfig'),
    dictation: localStorage.getItem('wordDictationConfig'),
    trans: localStorage.getItem('typingTransVisible'),
    pronunciation: localStorage.getItem('pronunciation'),
    phonetic: localStorage.getItem('phoneticConfig'),
  }))
  expect(afterReturn).toEqual(before)
})

test('light app theme keeps inherited Typing header controls readable when OS prefers dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => {
    localStorage.setItem('isOpenDarkModeAtom', JSON.stringify(false))
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
  })

  await page.goto('/typing')

  const html = page.locator('html')
  await expect(html).not.toHaveClass(/dark/)
  await expect(html).toHaveCSS('color-scheme', 'light')

  const header = page.locator('header nav')
  await expect(header).toHaveCSS('background-color', 'rgb(255, 255, 255)')

  const dictionary = header.locator('a[href="/gallery"]')
  const chapter = header.getByRole('button', {
    name: '第 1 章',
    exact: true,
  })
  const pronunciation = header.getByRole('button', {
    name: /发音及音标切换：/,
  })

  await expect(dictionary).toBeVisible()
  await expect(chapter).toBeVisible()
  await expect(pronunciation).toBeVisible()

  const colors = await Promise.all(
    [dictionary, chapter, pronunciation].map((control) =>
      control.evaluate((element) => getComputedStyle(element).color),
    ),
  )

  for (const color of colors) {
    expect(color).not.toBe('rgb(255, 255, 255)')
    expect(color).not.toBe('rgba(255, 255, 255, 1)')
    expect(color).not.toBe('rgba(0, 0, 0, 0)')
  }
})

test('Typing and Learn use the same indigo interaction palette', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('isOpenDarkModeAtom', JSON.stringify(false))
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
  })

  await page.goto('/typing')

  const typingMode = page.getByRole('button', {
    name: 'Typing',
    exact: true,
  })
  const typingStart = page.getByRole('button', {
    name: '开始',
    exact: true,
  })

  const typingModeColor = await typingMode.evaluate(
    (element) => getComputedStyle(element).color,
  )
  const typingStartBackground = await typingStart.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )
  const typingDictionary = page.locator('header nav a[href="/gallery"]')
  await typingDictionary.hover()
  const typingTransitionMs = await typingDictionary.evaluate((element) => {
    const value = getComputedStyle(element).transitionDuration.split(',')[0]
    return Number.parseFloat(value) * (value.includes('ms') ? 1 : 1000)
  })
  await page.waitForTimeout(typingTransitionMs + 50)
  const typingDictionaryHoverBackground = await typingDictionary.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )

  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/learn$/)

  const learnMode = page.getByRole('button', {
    name: 'Learn',
    exact: true,
  })
  const learnStart = page.getByRole('button', {
    name: '开始',
    exact: true,
  })

  await expect(learnMode).toHaveCSS('color', typingModeColor)
  await expect(learnStart).toHaveCSS(
    'background-color',
    typingStartBackground,
  )

  const learnDictionary = page.locator('header nav a[href="/gallery?mode=learn"]')
  await learnDictionary.hover()
  const learnTransitionMs = await learnDictionary.evaluate((element) => {
    const value = getComputedStyle(element).transitionDuration.split(',')[0]
    return Number.parseFloat(value) * (value.includes('ms') ? 1 : 1000)
  })
  await page.waitForTimeout(learnTransitionMs + 50)
  await expect(learnDictionary).toHaveCSS(
    'background-color',
    typingDictionaryHoverBackground,
  )
})

