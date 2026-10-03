import { expect, test } from '@playwright/test'
import fs from 'node:fs'

const audioFixture = fs.readFileSync(
  'public/sounds/key-sound/Alpacas.mp3',
)

type AudioProbeWindow = Window & {
  __qwertyAudioPlays?: string[]
}

async function playedUrls(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => (window as AudioProbeWindow).__qwertyAudioPlays ?? [],
  )
}

test('ordinary Typing automatically pronounces consecutive clean words', async ({
  page,
}) => {
  await page.route('https://dict.youdao.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
      body: audioFixture,
    })
  })

  await page.addInitScript(() => {
    const target = window as AudioProbeWindow
    target.__qwertyAudioPlays = []

    // Stale Learn policy must be inert while isReviewMode is false.
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({
        isReviewMode: false,
        reviewRecord: {
          id: 991001,
          createTime: 991001,
          index: 0,
          isFinished: false,
          words: [],
          exercisePlans: {
            life: {
              condition: {
                version: 1,
                purpose: 'probe',
                source: 'adaptive-policy',
                audio: 'none',
                meaning: 'hidden',
                phonetic: 'hidden',
                letters: { mode: 'all-hidden' },
                probeDimension: 'audio',
              },
            },
          },
        },
      }),
    )

    const nativePlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function patchedPlay() {
      target.__qwertyAudioPlays?.push(this.currentSrc || this.src)
      const result = nativePlay.call(this)
      result?.catch(() => undefined)
      return result
    }
  })

  await page.goto('/typing')
  await expect(page.locator('[data-typing-word="life"]')).toBeVisible()
  await expect(page.getByText('按任意键开始')).toBeVisible()

  // The first legal key starts Typing and is intentionally not part of "life".
  await page.keyboard.press('a')

  await expect
    .poll(async () =>
      (await playedUrls(page)).filter((url) => url.includes('audio=life'))
        .length,
    )
    .toBeGreaterThanOrEqual(1)

  await page.keyboard.type('life')
  await expect(page.locator('[data-typing-word="break"]')).toBeVisible()

  await expect
    .poll(async () =>
      (await playedUrls(page)).filter((url) => url.includes('audio=break'))
        .length,
    )
    .toBeGreaterThanOrEqual(1)

  await page.keyboard.type('break')
  await expect(page.locator('[data-typing-word="ICT"]')).toBeVisible()
})
