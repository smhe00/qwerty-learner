/** Only ordinary learning entries may start a new V4 network preflight.
 * Account/tool/recovery documents retain their explicit transaction flows. */
export function shouldCheckAccountV4AtStartup(input: {
  pathname: string
  search: string
  account: boolean
  liveAuth: boolean
  enabled: boolean
  online: boolean
}): boolean {
  const path = input.pathname.replace(/\/$/, '') || '/'
  return (
    input.account &&
    input.liveAuth &&
    input.enabled &&
    input.online &&
    input.search === '' &&
    ['/', '/learn', '/mobile', '/mobile/study'].includes(path)
  )
}
