/**
 * Standalone read-only Song achievement visual smoke.
 * Browser automation never signs in or writes Learn/Typing/achievement state.
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const origin = process.env.SONG_PREVIEW_ORIGIN || 'http://127.0.0.1:4321'
const url = origin + '/qwerty-learner/previews/song-achievements/'
const screenshots = 'tests/song-preview/artifacts'
await mkdir(screenshots, { recursive: true })
const fogUrl = url + 'assets/achievements/song/shared/mist/far-light.webp'
const fogResponse = await fetch(fogUrl)
const fogBytes = new Uint8Array(await fogResponse.arrayBuffer())
console.log('Static fog resource probe:', {
  url:fogUrl,
  status:fogResponse.status,
  mime:fogResponse.headers.get('content-type'),
  head:Array.from(fogBytes.slice(0,12)),
  size:fogBytes.length,
})
const browser = await chromium.launch({ headless: true })

async function checkViewport(name, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'no-preference' })
  const pageErrors = []
  const brokenImages = []
  const fogResponses = []
  const resourceFailures = []
  page.on('requestfailed', req => resourceFailures.push(req.url() + ' ' + req.failure()?.errorText))
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('response', resp => {
    if (resp.url().includes('/assets/achievements/song/')) {
      fogResponses.push({url:resp.url(),status:resp.status(),contentType:resp.headers()['content-type']})
      if (resp.status() >= 400) brokenImages.push(resp.url() + ' status ' + resp.status())
    }
  })

  const response = await page.goto(url, { waitUntil: 'networkidle' })
  assert.equal(response.status(), 200)
  await page.locator('.song-preview-gallery').waitFor()
  assert.equal(await page.locator('.song-picture-mist').count() > 0, true, 'at least one locked card has mist')
  // Locked artworks sit below the curator showcase and use native lazy loading.
  // A browser smoke must scroll them into the viewport before demanding decode.
  await page.locator('.song-picture-mist').first().scrollIntoViewIfNeeded()
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.song-picture-mist-near')).some(img => img.naturalWidth > 0), null, { timeout: 12000 })
  const fogImages = await page.locator('.song-picture-mist-near').count()
  console.log(name + ' cloud diagnostic:', {
    fogImages, brokenImages, fogResponses, resourceFailures,
    imageUrls: await page.locator('.song-picture-mist img').evaluateAll(
      nodes => nodes.map(node => ({ src: node.currentSrc, complete: node.complete, width: node.naturalWidth }))
    ),
  })
  assert.ok(fogImages > 0, name + ' no image fog found; broken requests: ' + brokenImages.join('; '))
  await page.locator('.song-picture-mist-near').first().evaluate(img => img.decode())
  assert.deepEqual(brokenImages, [], name + ' missing WebP layer')

  const before = await page.locator('.song-preview-gallery').getAttribute('data-song-theme')
  assert.equal(before, 'light')
  await page.getByRole('button', { name: '切换夜卷主题' }).click()
  assert.equal(await page.locator('.song-preview-gallery').getAttribute('data-song-theme'), 'dark')
  await page.getByRole('button', { name: '切换晨卷主题' }).click()
  assert.equal(await page.locator('.song-preview-gallery').getAttribute('data-song-theme'), 'light')

  await page.getByRole('button', { name: /展卷.*落朱钤印/ }).first().click()
  await page.locator('.song-master-scroll-sheet').waitFor()
  let animation = await page.locator('.song-master-floating-seal').evaluate(
    el => getComputedStyle(el).animationName
  )
  assert.match(animation, /song-master-stampfall/, name + ' stamp must animate on desktop and mobile')
  await page.getByRole('button', { name: /重播钤印/ }).click()
  animation = await page.locator('.song-master-floating-seal').evaluate(
    el => getComputedStyle(el).animationName
  )
  assert.match(animation, /song-master-stampfall/, name + ' replay must re-arm stamp animation')
  await page.screenshot({ path: screenshots + '/' + name + '.png', fullPage: true })
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.song-master-scroll-sheet').count(), 0, 'Escape closes detail')

  const size = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth, viewport: innerWidth,
  }))
  assert.ok(size.documentWidth <= size.viewport + 2, name + ' horizontal document overflow: ' + JSON.stringify(size))
  assert.deepEqual(pageErrors, [], name + ' page errors')
  await page.close()
  console.log('PASS', name, size)
}

try {
  await checkViewport('desktop-1440', 1440, 900)
  await checkViewport('mobile-390', 390, 844)
} finally {
  await browser.close()
}
