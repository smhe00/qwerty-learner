import { expect, type Page } from '@playwright/test'

// An isolated Playwright-only virtual business clock.
// Never add a public UI switch, query argument or production endpoint.
// Native setTimeout/performance.now stay real, preserving spelling feedback.
export const EXPLORER_PAGES_ORIGIN = 'https://smhe00.github.io'
export const EXPLORER_PAGES_PATH = '/qwerty-learner/'
const CLOCK_STORAGE = '__qwertyPagesExplorerVirtualDateV1'

export async function installExplorerBusinessClock(
  page: Page,
  epochMs = Date.UTC(2026, 9, 10, 12, 0, 0),
) {
  await page.addInitScript(
    ({ origin, prefix, storageKey, initialMs }) => {
      if (location.origin !== origin || !location.pathname.startsWith(prefix)) return
      const NativeDate = Date
      const stored = Number(sessionStorage.getItem(storageKey))
      let effectiveMs = Number.isFinite(stored) && stored > 0 ? stored : initialMs

      const VirtualDate = new Proxy(NativeDate, {
        construct(target, args) {
          return Reflect.construct(target, args.length ? args : [effectiveMs])
        },
        apply() {
          return new NativeDate(effectiveMs).toString()
        },
        get(target, prop, receiver) {
          if (prop === 'now') return () => effectiveMs
          return Reflect.get(target, prop, receiver)
        },
      })
      Object.defineProperty(window, 'Date', {
        configurable: false,
        writable: false,
        value: VirtualDate,
      })
      Object.defineProperty(window, '__qwertyPagesExplorerClock', {
        configurable: false,
        value: Object.freeze({
          now: () => effectiveMs,
          advanceSeconds(seconds: number) {
            if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 45 * 86400) {
              throw new Error('Explorer clock jump outside the approved 45-day bound')
            }
            effectiveMs += Math.floor(seconds * 1000)
            sessionStorage.setItem(storageKey, String(effectiveMs))
            return effectiveMs
          },
        }),
      })
    },
    { origin: EXPLORER_PAGES_ORIGIN, prefix: EXPLORER_PAGES_PATH,
      storageKey: CLOCK_STORAGE, initialMs: epochMs },
  )
}

type ClockWindow = Window & {
  __qwertyPagesExplorerClock?: {
    now: () => number
    advanceSeconds: (seconds: number) => number
  }
}

export async function advanceIdleBusinessTime(page: Page, seconds: number) {
  // Strictly between learning interactions; never run while Typing or Learn
  // is capturing keyboard events. This guard is part of the test harness,
  // NOT a hidden public product capability.
  const origin = new URL(page.url())
  expect(origin.origin).toBe(EXPLORER_PAGES_ORIGIN)
  expect(origin.pathname).toMatch(/^\/qwerty-learner\/(?:typing)?\/?$/)
  const result = await page.evaluate((delta) => {
    const clock = (window as ClockWindow).__qwertyPagesExplorerClock
    if (!clock) throw new Error('Explorer clock unavailable; refusing real-time wait')
    const before = clock.now()
    const after = clock.advanceSeconds(delta)
    return { before, after, dateNow: Date.now() }
  }, seconds)
  expect(result.after - result.before).toBe(Math.floor(seconds * 1000))
  expect(result.dateNow).toBe(result.after)
  return result
}

export async function readExplorerBusinessTime(page: Page) {
  return page.evaluate(() => {
    const clock = (window as ClockWindow).__qwertyPagesExplorerClock
    if (!clock) throw new Error('Explorer clock unavailable')
    return { dateNow: Date.now(), clockNow: clock.now() }
  })
}
