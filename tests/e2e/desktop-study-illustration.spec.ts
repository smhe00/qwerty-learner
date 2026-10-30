import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Word } from '../../src/typings'
import { readReviewModeInfo, seedAcquisitionSession } from './review-flow-harness'
import { auditVisibleUI, prepareVisibleUI } from './ui-visible-audit'
import { uiPath } from './ui-test-path'

const dictionary: Word[] = JSON.parse(readFileSync('public/dicts/ShanghaiZhongkao2027.json', 'utf8'))
const words = ['ability', 'able', 'remember'].map(name => dictionary.find(word => word.name === name)!)
const figure = '[data-desktop-study-illustration]'

async function open(page: Page, dark: boolean, mode: 'keyboard' | 'touch', phase: 'exposure' | 'independent', mobile = false) {
  await prepareVisibleUI(page, dark)
  await page.addInitScript(mode => localStorage.setItem('learnInputMode', mode), mode)
  await seedAcquisitionSession(page, words, 983720, phase, 4, 'unknown', {}, true, 'shanghai-zhongkao-2027')
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

for (const mode of ['keyboard', 'touch'] as const) {
  test('PC ' + mode + ' image sits beside the meaning, hides on pause/resize and keeps progress unchanged', async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('desktop'), 'PC experiment')
    await open(page, info.project.name.endsWith('dark'), mode, 'exposure')
    const image = page.locator(figure)
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('data-illustration-word', 'ability')
    await expect.poll(() => image.locator('img').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(512)
    await expect(image.getByRole('link', { name: 'Word Atlas contributors' })).toBeVisible()
    const anchor = page.locator(mode === 'keyboard' ? '.focus-word-stack' : '[data-desktop-tap-practice]')
    const a = (await anchor.boundingBox())!
    const b = (await image.boundingBox())!
    expect(b.x - a.x - a.width).toBeGreaterThanOrEqual(24)
    expect(b.x + b.width).toBeLessThanOrEqual(1440 - 24)
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
  })

  test('PC ' + mode + ' cold recall does not request an answer image', async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('desktop'), 'PC experiment')
    const requests: string[] = []
    page.on('request', request => { if (/images\/word-atlas\/.*\.webp/.test(request.url())) requests.push(request.url()) })
    await open(page, info.project.name.endsWith('dark'), mode, 'independent')
    await expect(page.locator(figure)).toHaveCount(0)
    expect(requests).toEqual([])
  })
}

test('mobile study never requests PC illustrations, including a desktop-sized window', async ({ page }, info) => {
  const requests: string[] = []
  page.on('request', request => { if (/images\/word-atlas\/.*\.webp/.test(request.url())) requests.push(request.url()) })
  await open(page, info.project.name.endsWith('dark'), 'touch', 'exposure', true)
  await expect(page.locator(figure)).toHaveCount(0)
  expect(requests).toEqual([])
})

test('a failed image removes its frame and leaves meaning and learning actions usable', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'PC experiment')
  const catalog = JSON.parse(readFileSync('src/resources/study-illustrations.json', 'utf8'))
  const failedId = catalog.find((entry: { word: string }) => entry.word === 'ability').sourceId
  await page.route('**/images/word-atlas/*.webp', route => route.request().url().includes(failedId)
    ? route.fulfill({ status: 404, body: '' }) : route.continue())
  await open(page, info.project.name.endsWith('dark'), 'touch', 'exposure')
  await expect(page.locator(figure)).toHaveCount(0)
  const card = page.locator('[data-desktop-tap-practice]')
  await expect(card.locator('[data-dictionary-senses]')).toBeVisible()
  await card.getByRole('button', { name: '继续学习', exact: true }).click()
  await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
  await expect(card).toHaveAttribute('data-mobile-word', 'able')
  await expect(page.locator(figure)).toHaveAttribute('data-illustration-word', 'able')
  await expect.poll(() => page.locator(figure + ' img').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(512)
})
