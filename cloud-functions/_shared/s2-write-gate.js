/* eslint-env node */
/**
 * Public S2 V4 rollout: any valid authenticated immutable account may write.
 * An explicit emergency kill switch can disable new S2 writes globally.
 *
 * The legacy S2_SYNC_WRITE_ACCOUNT_IDS allowlist is intentionally ignored.
 * Authentication, owner binding, V4 payload validation, V3 migration
 * protection and revision CAS remain enforced by the backend service.
 */
export function isS2WriteEnabled(disabledFlag) {
  return disabledFlag !== true &&
    disabledFlag !== 1 &&
    !(['true', '1', 'yes', 'on'].includes(
      typeof disabledFlag === 'string' ? disabledFlag.trim().toLowerCase() : '',
    ))
}
