/** Presentation/navigation metadata only. Never authorizes ownership or skips boot. */
const KEY = 'qwerty.account-journey.v1'
const MAX_AGE_MS = 30 * 60_000
const TARGETS = new Set([
  '/', '/learn', '/typing', '/mobile', '/mobile/study', '/mobile/data', '/mobile/settings', '/mobile/library',
  '/mobile/history', '/mobile/achievements', '/mobile/guide', '/mobile/circles', '/gallery', '/analysis',
  '/error-book', '/achievements', '/guide', '/friend-links', '/circles',
])
type Journey = { version: 1; mobile: boolean; target: string; phase: 'account' | 'preparing' | 'returning'; createdAt: number }
const base = () => REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner' : ''
const path = () => (window.location.pathname || '/').replace(base(), '').replace(/\/$/, '') || '/'
function read(): Journey | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null') as Journey | null
    return value?.version === 1 && typeof value.mobile === 'boolean' && TARGETS.has(value.target) &&
      ['account', 'preparing', 'returning'].includes(value.phase) && Number.isSafeInteger(value.createdAt) &&
      Date.now() >= value.createdAt && Date.now() - value.createdAt <= MAX_AGE_MS ? value : null
  } catch { return null }
}
function save(value: Journey) {
  try { sessionStorage.setItem(KEY, JSON.stringify(value)) } catch { /* Return to home if metadata is unavailable. */ }
}
export function rememberAccountEntry(mobile: boolean) {
  const source = path()
  save({ version: 1, mobile, target: TARGETS.has(source) ? source : mobile ? '/mobile' : '/', phase: 'account', createdAt: Date.now() })
}
export function beginAccountReturn(mobile: boolean, phase: 'preparing' | 'returning') {
  const current = read()
  save({ version: 1, mobile, target: current?.mobile === mobile ? current.target : mobile ? '/mobile' : '/', phase, createdAt: Date.now() })
}
export function accountProgressContext(): { mobile: boolean; preparing: boolean; returning: boolean } | null {
  const currentPath = path()
  const account = currentPath === '/mobile/account' || (currentPath === '/' && new URLSearchParams(window.location.search).get('s1-account') === 'manage')
  if (account) return { mobile: currentPath === '/mobile/account', preparing: false, returning: false }
  const current = read()
  return current && current.phase !== 'account' && window.location.search === '' && ['/', '/mobile'].includes(currentPath)
    ? { mobile: current.mobile, preparing: current.phase === 'preparing', returning: current.phase === 'returning' } : null
}
/** Call only after the ordinary home bootstrap passes, immediately before app import. */
export function finishAccountReturn() {
  const current = read()
  if (!current || current.phase === 'account' || !['/', '/mobile'].includes(path()) || window.location.search !== '') return
  try { sessionStorage.removeItem(KEY) } catch { /* Metadata is not an authorization source. */ }
  try { window.history.replaceState(null, '', base() + current.target) } catch { /* Stay on the admitted home page. */ }
}
