/* eslint-env node */
/** Historical CAS adapter is disabled. Use createCircleEventLog for new work. */
export function createCircleBlobStorage() {
  throw new TypeError('CAS Circle storage disabled; use createCircleEventLog')
}
