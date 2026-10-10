/* eslint-env node */
// Real EdgeOne Maker Chromium smoke. Read-only: never logs in or changes user data.
// Ensures pilot S2 routes fail closed before any mounted React writer is active.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const base = 'https://qwerty-plus.edgeone.dev/'
const browser = await chromium.launch({ headless: true })
try {
  const [a, b] = await Promise.all([
    browser.newContext({ serviceWorkers: 'block' }),
    browser.newContext({ serviceWorkers: 'block' }),
  ])
  const [pageA, pageB] = await Promise.all([a.newPage(), b.newPage()])
  const responses = await Promise.all([
    pageA.goto(base + '?s2-sync=run', { waitUntil: 'domcontentloaded' }),
    pageB.goto(base + '?s2-recovery=manage', { waitUntil: 'domcontentloaded' }),
  ])
  assert.equal(responses[0]?.status(), 200, 'Maker Sync guard route HTTP status')
  assert.equal(responses[1]?.status(), 200, 'Maker Recovery guard route HTTP status')
  await pageA.getByText('S2 Sync 尚未在此部署启用。').waitFor({
    state: 'visible', timeout: 20000,
  })
  await pageB.getByText('S2 高级恢复尚未在此部署启用。').waitFor({
    state: 'visible', timeout: 20000,
  })
  assert.equal(await pageA.locator('body').getByText(
    '学习数据安全检查未通过').count(), 1)
  assert.equal(await pageB.locator('body').getByText(
    '学习数据安全检查未通过').count(), 1)
  assert.notEqual(a, b, 'independent Chromium contexts required')
  console.log('P4b REAL Maker Chromium independent contexts/S2 fail-closed: PASS')
  await a.close()
  await b.close()
} finally {
  await browser.close()
}
