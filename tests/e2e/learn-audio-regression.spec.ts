// Regression coverage for TASK-20261006-006.
//
// A Learn session renders Typing in-place on the single `/learn` route. Sound
// resources were addressed with a document-relative prefix (`./sounds/`), which
// resolves against the *current document path* rather than the app root. Under
// assets must remain app-root safe while Learn shares the `/learn` route
// 404'd, silently killing both the typing-click and wrong-letter sounds while
// leaving absolute-URL pronunciation audio working.
//
// These tests assert the real playback boundary: HTTP status of the sound
// resources plus WebAudio/Howler start events. They are deliberately not
// assertions that a wrapper function merely exists.

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

type AudioEvent = {
  kind: 'howl-play' | 'media-play' | 'webaudio-source-start'
  src?: string
}

async function installAudioSpy(page: Page) {
  await page.addInitScript(() => {
    const log: AudioEvent[] = []
    const holder = window as unknown as { __audioLog: AudioEvent[] }
    holder.__audioLog = log
    const push = (event: AudioEvent) => {
      log.push(event)
    }

    // howler.js publishes `Howl`/`Howler` onto window when it loads. Intercept
    // the assignment so the prototype can be instrumented before any Howl is
    // constructed.
    let howlRef: unknown
    Object.defineProperty(window, 'Howl', {
      configurable: true,
      get: () => howlRef,
      set: (value: { prototype: Record<string, unknown> } & unknown) => {
        howlRef = value
        const proto = value.prototype as Record<string, unknown> & {
          __spied?: boolean
        }
        if (proto && !proto.__spied) {
          proto.__spied = true
          const originalPlay = proto.play as (...args: unknown[]) => unknown
          proto.play = function patchedPlay(this: { _src?: string }, ...args: unknown[]) {
            push({ kind: 'howl-play', src: String(this._src ?? '') })
            return originalPlay.apply(this, args)
          }
        }
      },
    })

    const originalMediaPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function patchedMediaPlay(this: HTMLMediaElement, ...args: unknown[]) {
      push({ kind: 'media-play', src: this.currentSrc || this.src })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalMediaPlay as any).apply(this, args)
    }

    const originalStart = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function patchedStart(this: AudioBufferSourceNode, ...args: unknown[]) {
      push({ kind: 'webaudio-source-start' })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalStart as any).apply(this, args)
    }
  })
}

async function seedLearnSession(page: Page) {
  await page.addInitScript(() => {
    const words = [
      { name: 'cancel', trans: ['取消'], usphone: 'kænsl', ukphone: 'kænsl' },
      { name: 'analyse', trans: ['分析'], usphone: 'ænəlaɪz', ukphone: 'ænəlaɪz' },
    ]
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(-1))
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({
        isReviewMode: true,
        reviewRecord: {
          id: 900977,
          dict: 'cet4',
          createTime: 900977,
          index: 0,
          isFinished: false,
          words,
          exercisePlans: Object.fromEntries(
            words.map((word) => [
              word.name,
              {
                version: 1,
                condition: {
                  version: 1,
                  purpose: 'probe',
                  source: 'adaptive-policy',
                  audio: 'none',
                  meaning: 'visible',
                  phonetic: 'hidden',
                  letters: { mode: 'all-hidden' },
                  probeDimension: 'none',
                },
                decision: {
                  version: 1,
                  policyVersion: 'canonical-review-probe-v1',
                  reasonCodes: ['canonical-long-term-probe'],
                  conditionVersion: 1,
                },
                sourceShadowVersion: 1,
              },
            ]),
          ),
        },
      }),
    )
    localStorage.setItem('loopWordConfig', JSON.stringify({ times: 1 }))
    localStorage.setItem(
      'pronunciation',
      JSON.stringify({
        isOpen: false,
        volume: 1,
        type: 'us',
        name: '美音',
        isLoop: false,
        isTransRead: false,
        transVolume: 1,
        rate: 1,
      }),
    )
    // Feedback sounds are explicitly enabled so a stored user preference can
    // never be mistaken for the regression being fixed here.
    localStorage.setItem(
      'keySoundsConfig',
      JSON.stringify({
        isOpen: true,
        isOpenClickSound: true,
        volume: 1,
        resource: { key: 'Default', name: 'Default', filename: 'Default.wav' },
      }),
    )
    localStorage.setItem(
      'hintSoundsConfig',
      JSON.stringify({
        isOpen: true,
        volume: 1,
        isOpenWrongSound: true,
        isOpenCorrectSound: true,
        wrongResource: { key: '1', name: '声音1', filename: 'beep.wav' },
        correctResource: { key: '1', name: '声音1', filename: 'correct.wav' },
      }),
    )
  })
}

async function seedTypingSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
    localStorage.setItem(
      'pronunciation',
      JSON.stringify({
        isOpen: false,
        volume: 1,
        type: 'us',
        name: '美音',
        isLoop: false,
        isTransRead: false,
        transVolume: 1,
        rate: 1,
      }),
    )
    localStorage.setItem(
      'keySoundsConfig',
      JSON.stringify({
        isOpen: true,
        isOpenClickSound: true,
        volume: 1,
        resource: { key: 'Default', name: 'Default', filename: 'Default.wav' },
      }),
    )
    localStorage.setItem(
      'hintSoundsConfig',
      JSON.stringify({
        isOpen: true,
        volume: 1,
        isOpenWrongSound: true,
        isOpenCorrectSound: true,
        wrongResource: { key: '1', name: '声音1', filename: 'beep.wav' },
        correctResource: { key: '1', name: '声音1', filename: 'correct.wav' },
      }),
    )
  })
}

function readAudioLog(page: Page): Promise<AudioEvent[]> {
  return page.evaluate(() => {
    const holder = window as unknown as { __audioLog?: AudioEvent[] }
    return holder.__audioLog ? holder.__audioLog.slice() : []
  })
}

function clearAudioLog(page: Page): Promise<void> {
  return page.evaluate(() => {
    const holder = window as unknown as { __audioLog?: AudioEvent[] }
    if (holder.__audioLog) holder.__audioLog.length = 0
  })
}

test('Learn sound resources resolve to the app root on the single Learn route', async ({ page }) => {
  const soundResponses: Array<{ status: number; path: string }> = []
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    // Match real audio assets only. A loose `/sounds/` substring test also
    // catches the dev-server module request for `/src/utils/sounds/keySounds.ts`.
    if (/\.(wav|mp3)$/.test(path)) {
      soundResponses.push({ status: response.status(), path })
    }
  })

  await installAudioSpy(page)
  await seedLearnSession(page)
  await page.goto('/learn')
  await page.getByText('按任意键开始').waitFor()
  await page.keyboard.press('a')
  await page.locator('[data-typing-word]').first().waitFor()

  // Drive both feedback paths so every sound resource is requested.
  const word = (await page.locator('[data-typing-word]').first().getAttribute('data-typing-word')) ?? ''
  await page.keyboard.press(word[0])
  await page.waitForTimeout(300)
  await page.keyboard.press(word[1] === 'x' ? 'q' : 'x')
  await page.waitForTimeout(600)

  expect(soundResponses.length).toBeGreaterThan(0)

  // The root cause: a document-relative prefix made these `/learn/sounds/...`.
  const wrongPaths = soundResponses.filter((entry) => !entry.path.startsWith('/sounds/')).map((entry) => entry.path)
  expect(wrongPaths).toEqual([])

  const failures = soundResponses.filter((entry) => entry.status >= 400)
  expect(failures).toEqual([])
})

test('Learn plays the key sound on a correct non-terminal letter', async ({ page }) => {
  await installAudioSpy(page)
  await seedLearnSession(page)
  await page.goto('/learn')
  await page.getByText('按任意键开始').waitFor()

  const wordEl = page.locator('[data-typing-word]').first()
  await wordEl.waitFor()
  await page.keyboard.press('a')
  await wordEl.waitFor()
  const word = (await wordEl.getAttribute('data-typing-word')) ?? ''

  await clearAudioLog(page)
  await page.keyboard.press(word[0])
  await expect.poll(async () => (await readAudioLog(page)).length).toBeGreaterThan(0)
  await page.waitForTimeout(400)

  const events = await readAudioLog(page)
  const playback = events.filter((event) => event.kind !== 'media-play')
  expect(playback.length).toBeGreaterThan(0)
})

test('Learn plays the wrong-letter sound on an incorrect letter', async ({ page }) => {
  await installAudioSpy(page)
  await seedLearnSession(page)
  await page.goto('/learn')
  await page.getByText('按任意键开始').waitFor()
  await page.keyboard.press('a')

  const wordEl = page.locator('[data-typing-word]').first()
  await wordEl.waitFor()
  const word = (await wordEl.getAttribute('data-typing-word')) ?? ''
  const wrongKey = word[1] === 'x' ? 'q' : 'x'

  await clearAudioLog(page)
  await page.keyboard.press(wrongKey)
  await expect.poll(async () => (await readAudioLog(page)).length).toBeGreaterThan(0)
  await page.waitForTimeout(400)

  const events = await readAudioLog(page)
  const wrongSound = events.filter(
    (event) => event.kind === 'howl-play' && (event.src ?? '').includes('beep.wav'),
  )
  expect(wrongSound.length).toBeGreaterThan(0)
})

test('Typing control keeps key and wrong sounds on the root route', async ({ page }) => {
  await installAudioSpy(page)
  await seedTypingSession(page)
  await page.goto('/')

  const wordEl = page.locator('[data-typing-word]').first()
  await wordEl.waitFor()
  const word = (await wordEl.getAttribute('data-typing-word')) ?? ''

  await clearAudioLog(page)
  await page.keyboard.press(word[0])
  await page.waitForTimeout(600)
  expect((await readAudioLog(page)).length).toBeGreaterThan(0)

  await clearAudioLog(page)
  await page.keyboard.press(word[1] === 'x' ? 'q' : 'x')
  await page.waitForTimeout(600)
  const wrongSound = (await readAudioLog(page)).filter(
    (event) => event.kind === 'howl-play' && (event.src ?? '').includes('beep.wav'),
  )
  expect(wrongSound.length).toBeGreaterThan(0)
})
