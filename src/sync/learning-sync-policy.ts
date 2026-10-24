/** Rollout boundary only. Live bearer, S1 lease and full M4 audits remain mandatory. */
export function isLearningSyncOrigin(origin: string): boolean {
  return origin === 'https://t.smhe.cn' || origin === 'https://q.smhe.cn' || origin === 'https://qwerty-plus.edgeone.dev'
}

export function learningEventSyncEnabled(): boolean {
  return (
    typeof window !== 'undefined' &&
    REACT_APP_DEPLOY_ENV !== 'pages' &&
    import.meta.env.VITE_QWERTY_SYNC_DISABLED !== 'true' &&
    isLearningSyncOrigin(window.location.origin)
  )
}

/** Secure counterpart only for approved public HTTP origins; never redirect previews/local dev. */
export function secureLearningEntry(href: string): string | null {
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' || url.username || url.password) return null
    url.protocol = 'https:'
    if (!isLearningSyncOrigin(url.origin)) return null
    // Account/session/debug query values must never cross an origin boundary.
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}
