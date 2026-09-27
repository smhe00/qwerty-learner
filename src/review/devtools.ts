import { getDueReviewDiagnostics, getReviewDictionaryDiagnostics, getReviewWordDiagnostics } from './diagnostics'
import type { DueReviewDiagnostic, ReviewDictionaryDiagnostics, ReviewWordDiagnostics } from './diagnostics'

export type ReviewDebugApi = {
  inspect(dict: string, word: string): Promise<ReviewWordDiagnostics>
  due(dict: string): Promise<DueReviewDiagnostic[]>
  stats(dict: string): Promise<ReviewDictionaryDiagnostics>
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
    stats: (dict) => getReviewDictionaryDiagnostics(dict),
  }

  debugWindow.__qwertyReviewDebug = api

  console.info(
    '[review] debug tools ready: inspect(dict, word), due(dict), stats(dict) via window.__qwertyReviewDebug',
  )

  return () => {
    if (debugWindow.__qwertyReviewDebug === api) {
      delete debugWindow.__qwertyReviewDebug
    }
  }
}
