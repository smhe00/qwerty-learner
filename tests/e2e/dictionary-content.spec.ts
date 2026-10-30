import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Word } from '../../src/typings'
import { readReviewModeInfo, seedAcquisitionSession } from './review-flow-harness'
import { auditVisibleUI, prepareVisibleUI } from './ui-visible-audit'
import { uiPath } from './ui-test-path'

const dictionary: Word[] = JSON.parse(readFileSync('public/dicts/ShanghaiZhongkao2027.json', 'utf8'))
const words = ['ability', 'able', 'remember'].map(name => dictionary.find(word => word.name === name)!)

async function open(page: Page, phase: 'exposure' | 'independent', dark: boolean) {
  await prepareVisibleUI(page, dark)
  await page.addInitScript(() => localStorage.setItem('learnInputMode', 'touch'))
  await seedAcquisitionSession(page, words, 983710, phase, 4, 'unknown', {}, true)
  await page.goto(uiPath('/mobile/study'))
  const card = page.locator('[data-mobile-word-practice]')
  await expect(card).toBeVisible({ timeout: 30000 })
  const resume = card.locator('[data-mobile-paused]').getByRole('button', { name: /继续学习/ })
  if (await resume.isVisible()) await resume.click()
  await expect(card).toHaveAttribute('data-mobile-word', 'ability')
  return card
}

test('authoritative word content expands without hiding the primary action or changing progress', async ({ page }, info) => {
  const card = await open(page, 'exposure', info.project.name.endsWith('dark'))
  await expect(card.locator('[data-dictionary-senses]')).toHaveText(words[0].content!.senses.map(entry => entry.text).join(''))
  const before = await readReviewModeInfo(page)
  const summary = card.locator('[data-dictionary-details] > summary')
  console.log('dictionary geometry', await card.evaluate(element => {
    const bounds = (selector: string) => {
      const node = element.querySelector(selector)
      return node ? JSON.stringify(node.getBoundingClientRect().toJSON()) : null
    }
    return { reading: bounds('[data-mobile-reading]'), meaning: bounds('[data-mobile-meaning-slot]'),
      summary: bounds('[data-dictionary-details] > summary'), action: bounds('.mobile-practice-primary') }
  }))
  await expect(summary).toBeInViewport({ ratio: 1 })
  const bounds = await summary.boundingBox()
  expect(bounds!.height).toBeGreaterThanOrEqual(44)
  await summary.click()
  await expect(card.locator('[data-dictionary-details]')).toHaveAttribute('open', '')
  for (const kind of ['collocations', 'relatedWords'] as const) {
    const items = card.locator('[data-dictionary-group="' + kind + '"] li')
    await expect(items).toHaveText(words[0].content![kind].map(entry => entry.text))
  }
  const action = card.getByRole('button', { name: '继续学习', exact: true })
  await expect(action).toBeInViewport({ ratio: 1 })
  await expect(action).toBeEnabled()
  expect(await readReviewModeInfo(page)).toEqual(before)
  await auditVisibleUI(page, info, 'dictionary-expanded')
  await page.screenshot({ path: info.outputPath('dictionary-expanded.png') })
  await summary.click()
  await page.getByRole('button', { name: '暂停学习', exact: true }).click()
  await expect(card.locator('[data-dictionary-content]')).toHaveAttribute('inert', '')
  await auditVisibleUI(page, info, 'dictionary-paused')
  await card.locator('[data-mobile-paused]').getByRole('button', { name: /继续学习/ }).click()
  await expect(card.locator('[data-dictionary-content]')).not.toHaveAttribute('inert', '')
  await action.click()
  await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
})

test('cold recall has no detail answer leaks; reveal and refresh retain all original text', async ({ page }, info) => {
  const card = await open(page, 'independent', info.project.name.endsWith('dark'))
  await expect(card).toHaveAttribute('data-mobile-task', 'recall')
  await expect(card.locator('[data-dictionary-content]')).toBeVisible()
  await expect(card.locator('[data-dictionary-details]')).toHaveCount(0)
  await expect(card.locator('[data-mobile-keyword]')).not.toHaveText('ability')
  for (const entry of words[0].content!.collocations) {
    await expect(card.getByText(entry.text, { exact: true })).toHaveCount(0)
  }
  await card.locator('[data-mobile-grade="hard"]').click()
  await expect(card.locator('[data-mobile-feedback]')).toBeVisible()
  await card.locator('[data-dictionary-details] > summary').click()
  await expect(card.locator('[data-dictionary-group="collocations"] li')).toHaveText(words[0].content!.collocations.map(entry => entry.text))
  const next = card.locator('[data-mobile-manual-next]')
  await expect(next).toBeInViewport({ ratio: 1 })
  const saved = await readReviewModeInfo(page)
  await page.reload()
  await expect(card).toBeVisible({ timeout: 30000 })
  expect((await readReviewModeInfo(page)).reviewRecord.words[0].content).toEqual(saved.reviewRecord.words[0].content)
  await auditVisibleUI(page, info, 'dictionary-refreshed')
})

test('long usage notes stay intact in the existing scroll panel', async ({ page }, info) => {
  await prepareVisibleUI(page, info.project.name.endsWith('dark'))
  const remember = dictionary.find(word => word.name === 'remember')!
  await page.addInitScript(() => localStorage.setItem('learnInputMode', 'touch'))
  await seedAcquisitionSession(page, [remember, words[0], words[1]], 983711, 'exposure', 4, 'unknown', {}, true)
  await page.goto(uiPath('/mobile/study'))
  const card = page.locator('[data-mobile-word-practice]')
  await expect(card).toHaveAttribute('data-mobile-word', 'remember', { timeout: 30000 })
  const resume = card.locator('[data-mobile-paused]').getByRole('button', { name: /继续学习/ })
  if (await resume.isVisible()) await resume.click()
  await card.locator('[data-dictionary-details] > summary').click()
  await expect(card.locator('[data-dictionary-group="notes"] li')).toHaveText(remember.content!.notes.map(entry => entry.text))
  await expect(card.getByRole('button', { name: '继续学习', exact: true })).toBeInViewport({ ratio: 1 })
  await auditVisibleUI(page, info, 'dictionary-long-notes')
  await page.screenshot({ path: info.outputPath('dictionary-long-notes.png') })
})
