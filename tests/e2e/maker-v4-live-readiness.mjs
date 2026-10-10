/* eslint-env node */
// Read-only health check of ACTUAL Maker deployment flags.
// Disposable Chromium profile; no production login, no cloud API writes.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const url = 'https://qwerty-plus.edgeone.dev/?s1-migration=confirm'
const browser = await chromium.launch({ headless: true })
try {
  const deadline = Date.now() + 12 * 60 * 1000
  let last = 'route not yet visible'
  let passed = false
  while (Date.now() < deadline && !passed) {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    try {
      const page = await context.newPage()
      const response = await page.goto(url, { waitUntil: 'domcontentloaded',
        timeout: 20000 })
      if (response?.status() !== 200) {
        last = 'HTTP ' + response?.status()
      } else {
        const heading = page.getByText('S1 本机学习数据归属确认')
        if (await heading.isVisible({ timeout: 1500 }).catch(() => false)) {
          const checkbox = page.getByRole('checkbox',
            { name: '已核对本机完整 V4 备份' })
          const button = page.getByRole('button',
            { name: '确认归属并建立隔离工作区' })
          assert.equal(await checkbox.count(), 1)
          assert.equal(await button.isDisabled(), true)
          passed = true
          console.log('Maker real deployment supervised S1 route: PASS')
          console.log('Maker backup-checkbox default-disabled Gate: PASS')
        } else {
          last = 'old frontend without supervised S1 migration route'
        }
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    } finally {
      await context.close()
    }
    if (!passed) await new Promise(resolve => setTimeout(resolve, 10000))
  }
  assert.equal(passed, true, 'Maker migration pilot not deployed: ' + last)
} finally {
  await browser.close()
}
