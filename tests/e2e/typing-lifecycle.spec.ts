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

  const completedLife = page.locator('[data-typing-word="life"]')
  await expect(completedLife).toHaveAttribute(
    'data-typing-success-feedback',
    'active',
    { timeout: 450 },
  )
  await expect
    .poll(async () =>
      (await playedUrls(page)).filter((url) => url.includes('audio=life'))
        .length,
    )
    .toBeGreaterThanOrEqual(2)

  // Space is the explicit fast path between completed learning items.
  await page.keyboard.press('Space')
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


test('phrase-internal Space remains a spelling character and rich example reveals on success', async ({
  page,
}) => {
  const fixtureWords = [
    {
      name: 'ice cream',
      trans: ['n. 冰淇淋'],
      usphone: 'aɪs kriːm',
      ukphone: 'aɪs kriːm',
      example: [
        {
          en: 'I like ice creams.',
          cn: '我喜欢冰淇淋。',
          start: 7,
          end: 17,
        },
      ],
      tags: ['fixture'],
    },
    {
      name: 'next',
      trans: ['adj. 下一个'],
      usphone: 'nekst',
      ukphone: 'nekst',
    },
  ]

  await page.route('**/dicts/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtureWords),
    })
  })

  await page.goto('/typing')
  await expect(page.locator('[data-typing-word="ice cream"]')).toBeVisible()
  await expect(page.getByText('按任意键开始')).toBeVisible()

  // Start key is not part of the spelling target.
  await page.keyboard.press('a')

  const word = page.locator('[data-typing-word="ice cream"]')
  const example = page.locator('[data-typing-example="visible"]')
  await expect(example).toHaveAttribute(
    'data-typing-example-revealed',
    'false',
  )
  await expect(example).toContainText('I like __________.')

  // The internal Space is a normal target character, not a control key.
  await page.keyboard.type('ice cream')

  await expect(word).toHaveAttribute(
    'data-typing-success-feedback',
    'active',
    { timeout: 450 },
  )
  await expect(example).toHaveAttribute(
    'data-typing-example-revealed',
    'true',
  )
  await expect(example.locator('[data-typing-example-surface]')).toHaveAttribute(
    'data-typing-example-surface',
    'ice creams',
  )

  // Once success is reached, Space changes role and fast-forwards.
  await page.keyboard.press('Space')
  await expect(page.locator('[data-typing-word="next"]')).toBeVisible()
})
