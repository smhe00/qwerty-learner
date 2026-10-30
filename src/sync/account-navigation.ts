import { beginAccountVisit } from './account-passive-return'
import { rememberAccountEntry } from './account-journey'

/** Account mutations remain behind the existing pre-mount S1 writer guard. */
export function accountManagementHref(mobile = false): string {
  const base = REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner/' : '/'
  return base + (mobile ? 'mobile/account' : '?s1-account=manage')
}

export function openAccountManagement(mobile = false): void {
  // Replace the document: never retain the mounted learning writer as a
  // history/BFCache predecessor or release/steal its lease before destruction.
  // The destination selects login, account management or expired-session login.
  beginAccountVisit(mobile)
  rememberAccountEntry(mobile)
  window.location.replace(accountManagementHref(mobile))
}
