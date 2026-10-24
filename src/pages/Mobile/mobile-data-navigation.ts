/** Full-document entry only: tools own their existing S1 pre-mount transactions. */
const TOOLS = [
  '/?s2-sync=run', '/?v4-cloud-backup=download', '/?s2-recovery=manage',
  '/?v4-import=manage', '/?perf-report=view', '/?s1-migration=confirm',
]
export function mobileToolHref(path: string, deployEnvironment?: string): string {
  if (!TOOLS.includes(path)) throw new Error('Unknown mobile data tool')
  return (deployEnvironment === 'pages' ? '/qwerty-learner' : '') + path
}
export function openMobileDataTool(path: string): void {
  // Do not retain an obsolete mounted writer in mobile back history.
  // The new document must acquire its own lease; never force-unlock it.
  window.location.replace(mobileToolHref(path, REACT_APP_DEPLOY_ENV))
}
