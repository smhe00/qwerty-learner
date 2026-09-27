import { getDueReviewDiagnostics, getReviewWordDiagnostics } from './diagnostics'
import type { DueReviewDiagnostic, ReviewWordDiagnostics } from './diagnostics'

export type ReviewDebugApi = {
  inspect(dict: string, word: string): Promise<ReviewWordDiagnostics>
  due(dict: string): Promise<DueReviewDiagnostic[]>
}

type ReviewDebugWindow = Window & {
  __qwertyReviewDebug?: ReviewDebugApi
}

export function installReviewDevtools(): () => void {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return () => undefined
  }

  const debugWindow = window as ReviewDebugWindow
  const api: ReviewDebugApi = {
    inspect: (dict, word) => getReviewWordDiagnostics(dict, word),
    due: (dict) => getDueReviewDiagnostics(dict),
  }

  debugWindow.__qwertyReviewDebug = api

  console.info(
    '[review] debug tools ready: await window.__qwertyReviewDebug.inspect("cet4", "receive") or await window.__qwertyReviewDebug.due("cet4")',
  )

  return () => {
    if (debugWindow.__qwertyReviewDebug === api) {
      delete debugWindow.__qwertyReviewDebug
    }
  }
}
