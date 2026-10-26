/** Navigation optimization only. Never authorizes mount, ownership or recovery. */
import { loadAuth } from './auth'
import type { CloudAuthState } from './types'
import type { Registry } from './workspace-transition'
import { S1_MIGRATION_WITNESS_KEY } from './workspace-v4'

export const ACCOUNT_VISIT_KEY = 'qwerty.account-visit.v1'
const MAX_AGE_MS = 5 * 60_000
export type AccountVisit = {
  version: 1
  phase: 'visiting' | 'returning'
  accountId: string
  generation: number
  witness: string
  createdAt: number
  target: '/' | '/mobile'
}
// Only a successfully guarded learning document can begin a passive visit.
// The token remains in memory; no credential is copied into sessionStorage.
let source: { accountId: string; generation: number; token: string } | null = null
export function setAccountVisitSource(registry: Registry, auth: CloudAuthState | null, allowed: boolean): void {
  source =
    allowed &&
    !registry.pending &&
    registry.active.kind === 'account' &&
    auth &&
    auth.user.userId === registry.active.accountId &&
    auth.expiresAt * 1000 > Date.now()
      ? { accountId: auth.user.userId, generation: registry.generation, token: auth.token }
      : null
}
function clear(): void {
  try {
    sessionStorage.removeItem(ACCOUNT_VISIT_KEY)
  } catch {
    /* Full startup remains the default. */
  }
}
function read(): AccountVisit | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(ACCOUNT_VISIT_KEY) || 'null') as AccountVisit | null
    if (
      !v ||
      v.version !== 1 ||
      !['visiting', 'returning'].includes(v.phase) ||
      typeof v.accountId !== 'string' ||
      !v.accountId ||
      !Number.isSafeInteger(v.generation) ||
      v.generation < 1 ||
      typeof v.witness !== 'string' ||
      !/^v2:[a-f0-9]{16}$/.test(v.witness) ||
      !Number.isSafeInteger(v.createdAt) ||
      Date.now() < v.createdAt ||
      Date.now() - v.createdAt > MAX_AGE_MS ||
      (v.target !== '/' && v.target !== '/mobile')
    )
      return null
    return v
  } catch {
    return null
  }
}
function save(ticket: AccountVisit): void {
  try {
    sessionStorage.setItem(ACCOUNT_VISIT_KEY, JSON.stringify(ticket))
  } catch {
    clear()
  }
}
export function matchesAccountVisit(ticket: AccountVisit | null, registry: Registry): boolean {
  const auth = loadAuth({ preserveExpired: true })
  return (
    !!ticket &&
    !registry.pending &&
    registry.active.kind === 'account' &&
    registry.generation === ticket.generation &&
    registry.active.accountId === ticket.accountId &&
    !!auth &&
    auth.user.userId === ticket.accountId &&
    auth.expiresAt * 1000 > Date.now() &&
    Date.now() >= ticket.createdAt &&
    Date.now() - ticket.createdAt <= MAX_AGE_MS &&
    localStorage.getItem(S1_MIGRATION_WITNESS_KEY) === ticket.witness &&
    localStorage.getItem('qwerty.s1.auth-transition.v1') === null &&
    sessionStorage.getItem('qwerty.s2.quick-sync.intent.v1') === null
  )
}
export function beginAccountVisit(mobile: boolean): void {
  clear()
  const auth = loadAuth({ preserveExpired: true })
  const witness = localStorage.getItem(S1_MIGRATION_WITNESS_KEY)
  if (
    !source ||
    !auth ||
    auth.token !== source.token ||
    auth.user.userId !== source.accountId ||
    auth.expiresAt * 1000 <= Date.now() ||
    !witness ||
    !/^v2:[a-f0-9]{16}$/.test(witness) ||
    sessionStorage.getItem('qwerty.s2.quick-sync.intent.v1') !== null
  )
    return
  save({
    version: 1,
    phase: 'visiting',
    accountId: source.accountId,
    generation: source.generation,
    witness,
    createdAt: Date.now(),
    target: mobile ? '/mobile' : '/',
  })
}
export function claimAccountVisit(registry: Registry, mobile: boolean): AccountVisit | null {
  const ticket = read()
  clear()
  return ticket?.phase === 'visiting' && ticket.target === (mobile ? '/mobile' : '/') && matchesAccountVisit(ticket, registry)
    ? ticket
    : null
}
export function finishPassiveAccountVisit(ticket: AccountVisit | null, registry: Registry): void {
  clear()
  if (matchesAccountVisit(ticket, registry) && ticket) save({ ...ticket, phase: 'returning' })
}
/** Consume BEFORE journal recovery; an interrupted return/reload cannot reuse it. */
export function takePassiveAccountReturn(): AccountVisit | null {
  source = null
  const ticket = read()
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  const search = window.location.search
  if (
    ticket?.phase === 'visiting' &&
    ((ticket.target === '/' && path === '/' && search === '?s1-account=manage') ||
      (ticket.target === '/mobile' && path === '/mobile/account' && search === ''))
  )
    return null
  clear()
  return ticket?.phase === 'returning' && path === ticket.target && search === '' ? ticket : null
}
