import {
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
  LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
  LEARN_ACQUISITION_SUPPORTED_POLICY_VERSION,
} from './acquisition'
import type { IWordRecord } from '@/utils/db/record'

export const LEGACY_ACQUISITION_POLICY_VERSION =
  'learn-acquisition-cold-probe-v2'

export function isAcquisitionIntroductionRecord(
  record: IWordRecord,
): boolean {
  return (
    record.sourceMode === 'learn' &&
    record.learnItemKind === 'acquisition'
  )
}

export function isModernPhasedAcquisitionRecord(
  record: IWordRecord,
): boolean {
  if (!isAcquisitionIntroductionRecord(record)) return false

  const policyVersion = record.reviewPolicyDecision?.policyVersion
  return (
    policyVersion === LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION ||
    policyVersion === LEARN_ACQUISITION_SUPPORTED_POLICY_VERSION ||
    policyVersion === LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION
  )
}

export function isValidModernAcquisitionAdmissionRecord(
  record: IWordRecord,
): boolean {
  if (!isAcquisitionIntroductionRecord(record)) return false

  return (
    record.reviewPolicyDecision?.policyVersion ===
      LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION &&
    record.wrongCount === 0 &&
    record.learningContext?.reviewHint === undefined &&
    record.reviewEvidence?.retrievalValidity === 'independent' &&
    record.reviewPolicyDecision.reasonCodes.includes('spacing-eligible')
  )
}

/**
 * Compatibility for the pre-phased acquisition rollout.
 *
 * Those rows were historically admitted immediately and must retain their
 * meaning. Current phased acquisition is never admitted through this path.
 */
export function isLegacyAcquisitionAdmissionRecord(
  record: IWordRecord,
): boolean {
  if (!isAcquisitionIntroductionRecord(record)) return false
  if (record.learningContext?.reviewHint !== undefined) return false

  const policyVersion = record.reviewPolicyDecision?.policyVersion
  return (
    policyVersion === undefined ||
    policyVersion === LEGACY_ACQUISITION_POLICY_VERSION
  )
}

export function isCompletedAcquisitionRecord(
  record: IWordRecord,
): boolean {
  return (
    isValidModernAcquisitionAdmissionRecord(record) ||
    isLegacyAcquisitionAdmissionRecord(record)
  )
}

export function hasModernPhasedAcquisition(
  records: IWordRecord[],
): boolean {
  return records.some(isModernPhasedAcquisitionRecord)
}

export function hasValidAcquisitionAdmission(
  records: IWordRecord[],
): boolean {
  return records.some(isCompletedAcquisitionRecord)
}

/**
 * A modern phased word must not have a persistent ACTIVE scheduler state until
 * a spacing-valid Independent attempt has actually crossed the admission gate.
 */
export function hasPrematureModernAcquisitionStateEvidence(
  records: IWordRecord[],
): boolean {
  return (
    hasModernPhasedAcquisition(records) &&
    !hasValidAcquisitionAdmission(records)
  )
}
