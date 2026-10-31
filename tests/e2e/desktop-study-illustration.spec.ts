import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Word } from '../../src/typings'
import { readReviewModeInfo, seedAcquisitionSession } from './review-flow-harness'
import { auditVisibleUI, prepareVisibleUI } from './ui-visible-audit'
import { uiPath } from './ui-test-path'

const dictionary: Word[] = JSON.parse(readFileSync('public/dicts/ShanghaiZhongkao2027.json', 'utf8'))
const words = ['able', 'bakery', 'remember'].map(name => dictionary.find(word => word.name === name)!)
const figure = '[data-desktop-study-illustration]'

async function open(page: Page, dark: boolean, mode: 'keyboard' | 'touch', phase: 'exposure' | 'independent', mobile = false, studyWords = words) {
  await prepareVisibleUI(page, dark)
  await page.addInitScript(mode => localStorage.setItem('learnInputMode', mode), mode)
  await seedAcquisitionSession(page, studyWords, 983720, phase, 4, 'unknown', {}, true, 'shanghai-zhongkao-2027')
  await page.goto(uiPath(mobile ? '/mobile/study' : '/learn'))
  if (mode === 'keyboard' && !mobile) {
    const start = page.getByRole('button', { name: /^(开始练习|继续练习)$/ })
    await expect(start).toBeVisible({ timeout: 30000 })
    await start.click()
  } else {
    const card = page.locator('[data-mobile-word-practice]')
    await expect(card).toBeVisible({ timeout: 30000 })
    const resume = card.locator('[data-mobile-paused]').getByRole('button', { name: /继续学习/ })
    if (await resume.isVisible()) await resume.click()
  }
}

for (const name of ['bakery', 'cook', 'television']) {
  for (const phase of ['exposure', 'independent'] as const) test('long daily ' + name + ' leaves the PC meaning and main action readable in ' + phase, async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('desktop'), 'PC daily text wrapping')
    const word = dictionary.find(word => word.name === name)!
    await open(page, info.project.name.endsWith('dark'), 'touch', phase, false, [word, words[0]])
    const card = page.locator('[data-desktop-tap-practice]')
    if (phase === 'independent') await card.getByRole('button', { name: /改用独立拼写/ }).click()
    await expect(card.locator('[data-dictionary-senses]')).toBeInViewport({ ratio: 1 })
    if (phase === 'exposure' && name !== 'television') await expect(card.locator('[data-dictionary-details] > summary')).toBeInViewport({ ratio: 1 })
    if (name === 'television') await expect(card.locator('[data-dictionary-details]')).toHaveCount(0)
    if (phase === 'independent') await expect(card.locator('[data-syllabus-examples]')).toHaveCount(0)
    await expect(card.locator('[data-mobile-example]')).toBeInViewport({ ratio: 1 })
    await expect(card.locator('.mobile-practice-primary')).toBeInViewport({ ratio: 1 })
    await expect(card.locator(figure)).toBeVisible()
    await auditVisibleUI(page, info, 'daily-long-' + phase + '-' + name)
    await page.screenshot({ path: info.outputPath('daily-long-' + phase + '-' + name + '.png') })
  })
}

for (const name of ['bread', 'zebra', 'device', 'bear', 'amusement']) {
  test('expanded catalog preserves the original PC meaning and asset boundary for ' + name, async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('desktop'), 'PC presentation')
    const word = dictionary.find(word => word.name === name)!
    const expected = ['bread', 'zebra'].includes(name)
    const requests: string[] = []
    page.on('request', request => { if (/images\/word-atlas\/.*\.webp/.test(request.url())) requests.push(request.url()) })
    await open(page, info.project.name.endsWith('dark'), 'keyboard', 'exposure', false, [word, words[0]])
    await expect(page.locator('[data-typing-word]')).toHaveText(name)
    await expect(page.locator('[data-dictionary-senses]')).toContainText(word.content!.senses[0]?.text || word.trans[0])
    if (expected) {
      await expect(page.locator(figure)).toHaveAttribute('data-illustration-word', name)
      await expect.poll(() => page.locator(figure + ' img').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(512)
      await expect(page.locator(figure + ' figcaption')).toHaveCount(0)
      expect(new Set(requests).size).toBe(1)
    } else {
      await expect(page.locator(figure)).toHaveCount(0)
      expect(requests).toEqual([])
    }
    await auditVisibleUI(page, info, 'pc-expanded-catalog-' + name)
    await page.screenshot({ path: info.outputPath('pc-expanded-catalog-' + name + '.png') })
  })
}

for (const mode of ['keyboard', 'touch'] as const) {
  test('PC ' + mode + ' image sits beside the meaning, hides on pause/resize and keeps progress unchanged', async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('desktop'), 'PC experiment')
    await open(page, info.project.name.endsWith('dark'), mode, 'exposure')
    const image = page.locator(figure)
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('data-illustration-word', 'able')
    await expect.poll(() => image.locator('img').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(512)
    await expect(image.locator('figcaption')).toHaveCount(0)
    await expect(image.getByRole('link')).toHaveCount(0)
    const anchor = page.locator(mode === 'keyboard' ? '.focus-word-stack' : '[data-desktop-tap-practice]')
    const b = (await image.boundingBox())!
    const token = (await anchor.locator(mode === 'keyboard' ? '[data-typing-word]' : '.mobile-practice-word').boundingBox())!
    expect(token.x - b.x - b.width).toBeGreaterThanOrEqual(24)
    expect(b.x).toBeGreaterThanOrEqual(32)
    expect(Math.abs(b.y + b.height / 2 - token.y - token.height / 2)).toBeLessThanOrEqual(1)
    const example = (await anchor.locator(mode === 'keyboard' ? '[data-typing-example]' : '[data-mobile-example-slot]').boundingBox())!
    expect(example.y - b.y - b.height).toBeGreaterThanOrEqual(8)
    const meaning = (await anchor.locator('[data-dictionary-senses]').boundingBox())!
    expect(meaning.y).toBeGreaterThan(b.y + b.height)
    const before = await readReviewModeInfo(page)
    const summary = anchor.locator('[data-dictionary-details] > summary')
    await expect(summary).toBeInViewport({ ratio: 1 })
    await summary.click()
    await expect(anchor.locator('[data-dictionary-group="collocations"] li')).toHaveText(words[0].content!.collocations.map(entry => entry.text))
    if (mode === 'touch') {
      // The touch card has a separate short scroller: prove its final source
      // entry is reachable while the primary action remains in place.
      const lastUsage = anchor.locator('[data-dictionary-group] li').last()
      await lastUsage.scrollIntoViewIfNeeded()
      await expect(lastUsage).toBeInViewport({ ratio: 1 })
    }
    if (mode === 'touch') await expect(anchor.getByRole('button', { name: '继续学习', exact: true })).toBeInViewport({ ratio: 1 })
    await expect(image).toBeVisible()
    await auditVisibleUI(page, info, 'pc-image-expanded-' + mode)
    await page.screenshot({ path: info.outputPath('pc-image-expanded-' + mode + '.png') })
    await summary.click()
    if (mode === 'touch') await anchor.locator('[data-mobile-definition-scroll]').evaluate(node => { node.scrollTop = 0 })
    await auditVisibleUI(page, info, 'pc-image-' + mode)
    await page.screenshot({ path: info.outputPath('pc-image-' + mode + '.png') })
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await expect(image).toHaveCount(0)
    if (mode === 'keyboard') await page.getByRole('button', { name: /^(开始练习|继续练习)$/ }).click()
    else await page.locator('[data-mobile-paused]').getByRole('button', { name: /继续学习/ }).click()
    await expect(image).toBeVisible()
    await page.setViewportSize({ width: 900, height: 600 })
    await expect(image).toHaveCount(0)
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(image).toBeVisible()
    expect(await readReviewModeInfo(page)).toEqual(before)
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await page.getByRole('button', { name: '开源 · GPL-3.0', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '关于 Qwerty Plus', exact: true })
    const attribution = dialog.locator('[data-word-atlas-attribution]')
    await expect(attribution).toContainText('Word Atlas contributors')
    await expect(attribution.getByRole('link', { name: 'Word Atlas 项目' })).toHaveAttribute('href', 'https://github.com/designfuchen/word-atlas')
    await expect(attribution.getByRole('link', { name: 'CC BY 4.0 许可' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/')
    for (const link of await attribution.getByRole('link').all()) {
      await expect(link).toBeInViewport({ ratio: 1 })
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await auditVisibleUI(page, info, 'pc-image-credits-' + mode)
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  })

  test('PC ' + mode + ' hides spelling answers while applying the requested picture cue', async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('desktop'), 'PC experiment')
    const requests: string[] = []
    page.on('request', request => { if (/images\/word-atlas\/.*\.webp/.test(request.url())) requests.push(request.url()) })
    await open(page, info.project.name.endsWith('dark'), mode, 'independent')
    if (mode === 'keyboard') {
      await expect(page.locator(figure)).toBeVisible()
      await expect(page.locator(figure + ' img')).toHaveAttribute('alt', '单词场景插画')
      await expect(page.locator('[data-typing-word]')).not.toHaveText('able')
      await expect(page.locator('[data-dictionary-details]')).toHaveCount(0)
      expect(requests.length).toBeGreaterThan(0)
    } else {
      await expect(page.locator(figure)).toHaveCount(0)
      expect(requests).toEqual([])
    }
  })

  test('PC ' + mode + ' can reach the final original example without expanding beyond the study viewport', async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('desktop'), 'PC original-example scrolling')
    const hear = dictionary.find(word => word.name === 'hear')!
    await open(page, info.project.name.endsWith('dark'), mode, 'exposure', false, [hear, words[0]])
    const originals = page.locator('[data-syllabus-examples]')
    await originals.locator('summary').click()
    const list = originals.getByRole('list', { name: '考纲原例句' })
    const last = list.locator('[data-syllabus-example]').last()
    await last.scrollIntoViewIfNeeded()
    await expect(last).toContainText(hear.example![hear.example!.length - 1].en)
    await expect(last).toBeInViewport({ ratio: 1 })
    expect((await list.boundingBox())!.height).toBeLessThanOrEqual(224)
    if (mode === 'touch') await expect(page.locator('[data-desktop-tap-practice] .mobile-practice-primary')).toBeInViewport({ ratio: 1 })
    await auditVisibleUI(page, info, 'daily-long-originals-' + mode)
  })
}

test('mobile study never requests PC illustrations, including a desktop-sized window', async ({ page }, info) => {
  const requests: string[] = []
  page.on('request', request => { if (/images\/word-atlas\/.*\.webp/.test(request.url())) requests.push(request.url()) })
  await open(page, info.project.name.endsWith('dark'), 'touch', 'exposure', true)
  await expect(page.locator(figure)).toHaveCount(0)
  expect(requests).toEqual([])
  await expect(page.locator('[data-mobile-example-slot]')).toHaveAttribute('data-study-example-source', 'syllabus')
  await expect(page.locator('[data-mobile-example]')).toHaveText(words[0].example![0].en)
  await expect(page.locator('[data-syllabus-examples]')).toHaveCount(0)
})

test('a failed image removes its frame and leaves meaning and learning actions usable', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'PC experiment')
  const catalog = JSON.parse(readFileSync('src/resources/study-illustrations.json', 'utf8'))
  const failedId = catalog.find((entry: { word: string }) => entry.word === 'able').sourceId
  await page.route('**/images/word-atlas/*.webp', route => route.request().url().includes(failedId)
    ? route.fulfill({ status: 404, body: '' }) : route.continue())
  await open(page, info.project.name.endsWith('dark'), 'touch', 'exposure')
  await expect(page.locator(figure)).toHaveCount(0)
  const card = page.locator('[data-desktop-tap-practice]')
  await expect(card.locator('[data-dictionary-senses]')).toBeVisible()
  await card.getByRole('button', { name: '继续学习', exact: true }).click()
  await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
  await expect(card).toHaveAttribute('data-mobile-word', 'bakery')
  await expect(page.locator(figure)).toHaveAttribute('data-illustration-word', 'bakery')
  await expect.poll(() => page.locator(figure + ' img').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(512)
})


test('PC touch dictation shows a scene with a masked word and keeps the submit action visible', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'PC experiment')
  await open(page, info.project.name.endsWith('dark'), 'touch', 'independent')
  const card = page.locator('[data-desktop-tap-practice]')
  await card.getByRole('button', { name: /改用独立拼写/ }).click()
  await expect(card).toHaveAttribute('data-mobile-task', 'spelling')
  await expect(page.locator(figure)).toBeVisible()
  await expect(page.locator(figure + ' img')).toHaveAttribute('alt', '单词场景插画')
  await expect(card.getByRole('heading', { name: '单词已隐藏', exact: true })).toBeVisible()
  await expect(card.locator('.mobile-practice-word')).not.toHaveText('able')
  await expect(card.locator('[data-dictionary-details]')).toHaveCount(0)
  await expect(card.locator('[data-syllabus-examples]')).toHaveCount(0)
  await expect(card.locator('[data-mobile-example-slot]')).toHaveAttribute('data-study-example-source', 'daily')
  await expect(card.locator('[data-mobile-example]')).toHaveText('日常例句 · I am finally ____ to swim across the pool.')
  await expect(card.locator('[data-mobile-example] [data-daily-example-label]')).toHaveText('日常例句 · ')
  await expect(card.locator('.mobile-practice-primary')).toBeInViewport({ ratio: 1 })
  await expect(card.locator('[data-dictionary-senses]')).toBeInViewport({ ratio: 1 })
  await auditVisibleUI(page, info, 'pc-image-dictation-touch')
  await page.screenshot({ path: info.outputPath('pc-image-dictation-touch.png') })
})

test('Typing dictation shows a neutral scene cue while English letters remain hidden', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'PC experiment')
  await prepareVisibleUI(page, info.project.name.endsWith('dark'))
  await page.addInitScript(() => {
    localStorage.setItem('currentDict', JSON.stringify('shanghai-zhongkao-2027'))
    localStorage.setItem('currentChapter', '0')
    localStorage.setItem('reviewModeInfo', JSON.stringify({ isReviewMode: false }))
    localStorage.setItem('wordDictationConfig', JSON.stringify({ isOpen: true, type: 'hideAll' }))
    localStorage.setItem('loopWordConfig', JSON.stringify({ times: 1 }))
    localStorage.setItem('pronunciation', JSON.stringify({ isOpen: false, isTransRead: false, volume: 0, type: 'us', name: '美音', isLoop: false, rate: 1 }))
  })
  await page.goto(uiPath('/typing'))
  await page.getByRole('button', { name: /^(开始练习|继续练习)$/ }).click()
  const word = page.locator('[data-typing-word]')
  await expect(word).toHaveAttribute('data-typing-word', 'ability')
  await expect(word).not.toHaveText('ability')
  await expect(page.locator(figure)).toHaveCount(0)
  await expect(page.locator('[data-dictionary-senses]')).toHaveText(dictionary.find(word => word.name === 'ability')!.content!.senses.map(entry => entry.text).join(''))
  await expect(page.locator('.focus-translation')).not.toContainText('ability')
  await expect(page.locator('[data-typing-example-en]')).not.toContainText('ability')
  await expect(page.locator('[data-dictionary-details]')).toHaveCount(0)
  await expect(page.locator('[data-syllabus-examples]')).toHaveCount(0)
  await expect(page.locator('[data-typing-example]')).toHaveAttribute('data-study-example-source', 'daily')
  await auditVisibleUI(page, info, 'pc-image-dictation-typing')
  await page.screenshot({ path: info.outputPath('pc-image-dictation-typing.png') })
  await page.keyboard.type('ability')
  await expect(word).toHaveAttribute('data-typing-word', 'able')
  await expect(page.locator(figure)).toHaveAttribute('data-illustration-word', 'able')
})

for (const mode of ['keyboard', 'touch'] as const) {
  test('PC ' + mode + ' retains every original example beside an independently reviewed daily supplement', async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('desktop'), 'PC supplement presentation')
    const water = dictionary.find(word => word.name === 'water')!
    await open(page, info.project.name.endsWith('dark'), mode, 'exposure', false, [water, words[0]])
    const anchor = page.locator(mode === 'keyboard' ? '.focus-word-stack' : '[data-desktop-tap-practice]')
    const daily = anchor.locator('[data-study-example-source]')
    await expect(daily).toHaveAttribute('data-study-example-source', 'daily')
    await expect(daily).toContainText('日常例句')
    await expect(daily).toContainText('the plants before we leave today.')
    // Water illustrates drinking, while the reviewed sentence is watering:
    // sentence quality must not accidentally enable the old picture.
    await expect(page.locator(figure)).toHaveCount(0)
    const before = await readReviewModeInfo(page)
    const originals = anchor.locator('[data-syllabus-examples]')
    await expect(originals.locator('summary')).toHaveText('考纲例句（2）')
    await originals.locator('summary').click()
    await expect(originals.locator('[data-syllabus-example]')).toHaveCount(water.example!.length)
    for (const [index, example] of water.example!.entries()) {
      const item = originals.locator('[data-syllabus-example]').nth(index)
      await item.scrollIntoViewIfNeeded()
      await expect(item).toContainText(example.en)
      await expect(item).toContainText(example.cn)
      await expect(item).toBeInViewport({ ratio: 1 })
    }
    if (mode === 'touch') await expect(anchor.getByRole('button', { name: '继续学习', exact: true })).toBeInViewport({ ratio: 1 })
    expect(await readReviewModeInfo(page)).toEqual(before)
    await auditVisibleUI(page, info, 'daily-and-syllabus-' + mode)
    await page.screenshot({ path: info.outputPath('daily-and-syllabus-' + mode + '.png') })
  })
}
