import { appendDeveloperTrace } from './diagnostic-trace'

export type BrowserFuzzGate =
  | 'learn-preparation'
  | 'review-persistence'

export type BrowserFuzzFault =
  | 'desktop-resize-navigates-root'

export type BrowserFuzzHookState = {
  gates?: Partial<Record<BrowserFuzzGate, boolean>>
  faults?: Partial<Record<BrowserFuzzFault, boolean>>
}

declare global {
  interface Window {
    __QWERTY_P3_TEST_HOOKS__?: BrowserFuzzHookState
  }
}

function hookState(): BrowserFuzzHookState | undefined {
  if (typeof window === 'undefined') return undefined
  return window.__QWERTY_P3_TEST_HOOKS__
}

export function isBrowserFuzzFaultEnabled(
  fault: BrowserFuzzFault,
): boolean {
  return hookState()?.faults?.[fault] === true
}

export async function waitForBrowserFuzzGate(
  gate: BrowserFuzzGate,
): Promise<void> {
  if (typeof window === 'undefined') return
  if (hookState()?.gates?.[gate] !== true) return

  appendDeveloperTrace({
    scope: 'runtime',
    event: 'p3-browser-fuzz-gate-wait',
    details: { gate },
  })

  await new Promise<void>((resolve) => {
    const release = (event: Event) => {
      const detail = (
        event as CustomEvent<{ gate?: BrowserFuzzGate | '*' }>
      ).detail
      if (
        detail?.gate !== gate &&
        detail?.gate !== '*'
      ) {
        return
      }

      window.removeEventListener(
        'qwerty:p3-fuzz-release',
        release,
      )
      appendDeveloperTrace({
        scope: 'runtime',
        event: 'p3-browser-fuzz-gate-release',
        details: { gate },
      })
      resolve()
    }

    window.addEventListener(
      'qwerty:p3-fuzz-release',
      release,
    )

    // A test may release the gate immediately before the listener is
    // installed. Re-read the synchronous state so the hook cannot deadlock.
    if (hookState()?.gates?.[gate] !== true) {
      window.removeEventListener(
        'qwerty:p3-fuzz-release',
        release,
      )
      resolve()
    }
  })
}
