/* eslint-env node */
// Read-only health check of ACTUAL Maker deployment flags.
// Disposable Chromium profile; no production login, no cloud API writes.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const origin = 'https://q.smhe.cn'
const url = origin + '/?s1-migration=confirm'
const legacyRecord = {
  word: 'synthetic-migration-readiness', dict: 'cet4', chapter: 0,
  timeStamp: 1_700_000_000, timing: [100], wrongCount: 0, mistakes: {},
}

// An empty origin is intentionally initialized without migrating history.
// Seed only this disposable browser's IDB before loading any application code.
async function seedLegacyProfile(page) {
  const seedUrl = origin + '/__local_migration_fixture__'
  await page.route(seedUrl, route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>Local fixture</title>',
  }))
  await page.goto(seedUrl)
  await page.evaluate(async row => {
    const request = indexedDB.open('RecordDB')
    request.onupgradeneeded = () => request.result.createObjectStore('wordRecords', { keyPath: 'id', autoIncrement: true })
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('wordRecords', 'readwrite')
        tx.objectStore('wordRecords').add(row)
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }, legacyRecord)
  await page.unroute(seedUrl)
}

async function readLegacyProfile(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise((resolve, reject) => {
        const rows = db.transaction('wordRecords').objectStore('wordRecords').getAll()
        rows.onsuccess = () => resolve(rows.result)
        rows.onerror = () => reject(rows.error)
      })
    } finally { db.close() }
  })
}
const browser = await chromium.launch({ headless: true })
try {
  const deadline = Date.now() + 12 * 60 * 1000
  let last = 'route not yet visible'
  let passed = false
  while (Date.now() < deadline && !passed) {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    try {
      const page = await context.newPage()
      await seedLegacyProfile(page)
      const response = await page.goto(url, { waitUntil: 'domcontentloaded',
        timeout: 20000 })
      if (response?.status() !== 200) {
        last = 'HTTP ' + response?.status()
      } else {
        const heading = page.getByText('S1 本机学习数据归属确认')
        if (await heading.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)) {
          const checkbox = page.getByRole('checkbox',
            { name: '已核对本机完整 V4 备份' })
          const button = page.getByRole('button',
            { name: '确认归属并建立隔离工作区' })
          assert.equal(await checkbox.count(), 1)
          assert.equal(await button.isDisabled(), true)
          assert.deepEqual(await readLegacyProfile(page), [{ ...legacyRecord, id: 1 }])
          passed = true
          console.log('Maker real deployment supervised S1 route: PASS')
          console.log('Maker backup-checkbox default-disabled Gate: PASS')
          console.log('Synthetic local legacy record unchanged: PASS')
        } else {
          last = 'supervised S1 migration route not visible for populated legacy profile'
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
