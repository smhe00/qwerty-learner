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

function silentWav(durationMs: number): Buffer {
  const sampleRate = 8_000
  const channels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const samples = Math.max(
    1,
    Math.floor((sampleRate * durationMs) / 1000),
  )
  const dataSize = samples * channels * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(
    sampleRate * channels * bytesPerSample,
    28,
  )
  buffer.writeUInt16LE(channels * bytesPerSample, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  return buffer
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
  await expect(
    example.locator('[data-typing-example-cn="visible"]'),
  ).toHaveText('我喜欢冰淇淋。')

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
  await expect(
    example.locator('[data-typing-example-cn="visible"]'),
  ).toHaveText('我喜欢冰淇淋。')

  // Once success is reached, Space changes role and fast-forwards.
  await page.keyboard.press('Space')
  await expect(page.locator('[data-typing-word="next"]')).toBeVisible()
})


test('production audio adapter ignores a stale previous-word load after fast-forward', async ({
  page,
}) => {
  const shortAudio = silentWav(180)

  await page.route('https://dict.youdao.com/**', async (route) => {
    const url = route.request().url()
    if (url.includes('audio=life')) {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    await route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
      body: shortAudio,
    })
  })

  await page.addInitScript(() => {
    const target = window as AudioProbeWindow
    target.__qwertyAudioPlays = []

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
  await page.keyboard.press('a')
  await page.keyboard.type('life')

  await expect(
    page.locator('[data-typing-word="life"]'),
  ).toHaveAttribute(
    'data-typing-success-feedback',
    'active',
  )

  // Explicit fast-forward is allowed even while the old audio request is
  // still unresolved. The old owner must never gain permission to play later.
  await page.keyboard.press('Space')
  await expect(
    page.locator('[data-typing-word="break"]'),
  ).toBeVisible()

  await expect
    .poll(async () =>
      (await playedUrls(page)).some((url) =>
        url.includes('audio=break'),
      ),
    )
    .toBe(true)

  const lifePlaysAtOwnerSwitch = (
    await playedUrls(page)
  ).filter((url) => url.includes('audio=life')).length

  await page.waitForTimeout(1_300)

  const playsAfterOldLoad = await playedUrls(page)
  expect(
    playsAfterOldLoad.filter((url) => url.includes('audio=life'))
      .length,
  ).toBe(lifePlaysAtOwnerSwitch)
  expect(
    playsAfterOldLoad.filter((url) => url.includes('audio=break'))
      .length,
  ).toBeGreaterThanOrEqual(1)
})

test('production success pronunciation completes before automatic advance', async ({
  page,
}) => {
  const longAudio = silentWav(1_400)

  await page.route('https://dict.youdao.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
      body: longAudio,
    })
  })

  await page.addInitScript(() => {
    const target = window as AudioProbeWindow
    target.__qwertyAudioPlays = []

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
  await page.keyboard.press('a')

  // Let the ordinary automatic pronunciation finish so the second play is
  // unambiguously the post-success pronunciation under test.
  await expect
    .poll(async () =>
      (await playedUrls(page)).filter((url) =>
        url.includes('audio=life'),
      ).length,
    )
    .toBeGreaterThanOrEqual(1)
  await page.waitForTimeout(1_550)

  await page.keyboard.type('life')
  await expect
    .poll(async () =>
      (await playedUrls(page)).filter((url) =>
        url.includes('audio=life'),
      ).length,
    )
    .toBeGreaterThanOrEqual(2)

  // Historical production advanced at 600 ms and truncated longer speech.
  // A 1.4 s real media element must still own the screen after that boundary.
  await page.waitForTimeout(750)
  await expect(
    page.locator('[data-typing-word="life"]'),
  ).toBeVisible()
  await expect(
    page.locator('[data-typing-word="break"]'),
  ).toHaveCount(0)

  await expect(
    page.locator('[data-typing-word="break"]'),
  ).toBeVisible({ timeout: 2_500 })
})


test('background pause preserves Typing counters when the page returns to foreground', async ({
  page,
}) => {
  await page.goto('/typing')
  await expect(page.locator('[data-typing-word="life"]')).toBeVisible()
  await page.keyboard.press('a')
  await page.keyboard.type('li')

  const readStats = async () =>
    page.locator('.my-card').last().locator('div').allTextContents()

  const before = await readStats()
  // Headless Chromium does not reliably emit a real window blur from
  // Page.bringToFront(). Drive the exact production listener deterministically:
  // blur pauses Typing; focus only resumes telemetry and must not reset counters.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
  })
  await expect(
    page.getByRole('button', {
      name: '开始',
      exact: true,
    }),
  ).toBeVisible()

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
  })
  await page.waitForTimeout(300)

  const after = await readStats()
  expect(after).toEqual(before)
})

test('Typing Skip never overlaps Start/Pause when it becomes visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto('/typing')
  await expect(page.locator('[data-typing-word="life"]')).toBeVisible()
  await page.keyboard.press('a')

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.keyboard.press('x')
    await page.waitForTimeout(350)
  }

  const skip = page.getByRole('button', {
    name: 'Skip',
    exact: true,
  })
  const pause = page.getByRole('button', {
    name: '暂停',
    exact: true,
  })
  await expect(skip).toBeVisible()
  await expect(pause).toBeVisible()

  const [skipBox, pauseBox] = await Promise.all([
    skip.boundingBox(),
    pause.boundingBox(),
  ])
  expect(skipBox).not.toBeNull()
  expect(pauseBox).not.toBeNull()
  if (!skipBox || !pauseBox) return

  const overlaps =
    skipBox.x < pauseBox.x + pauseBox.width &&
    skipBox.x + skipBox.width > pauseBox.x &&
    skipBox.y < pauseBox.y + pauseBox.height &&
    skipBox.y + skipBox.height > pauseBox.y
  expect(overlaps).toBe(false)
})


test('success pronunciation falls back when the Howl instance is not ready yet', async ({
  page,
}) => {
  const audio = silentWav(220)

  await page.route('https://dict.youdao.com/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
      body: audio,
    })
  })

  await page.addInitScript(() => {
    const target = window as AudioProbeWindow
    target.__qwertyAudioPlays = []
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
  await page.keyboard.press('a')

  const beforeSuccess = (
    await playedUrls(page)
  ).filter((url) => url.includes('audio=life')).length

  await page.keyboard.type('life')

  await expect
    .poll(async () =>
      (await playedUrls(page)).filter((url) =>
        url.includes('audio=life'),
      ).length,
    )
    .toBeGreaterThan(beforeSuccess)

  await expect(
    page.locator('[data-typing-word="break"]'),
  ).toBeVisible({ timeout: 2_000 })
})
