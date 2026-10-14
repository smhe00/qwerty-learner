/**
 * Account-scoped runtime clock synchronization for Learn.
 *
 * Probe EdgeOne when a signed-in user opens/starts Learn. If the wall clock
 * differs by <= 60 seconds, ignore the difference for FSRS. Larger stable
 * offsets are corrected in application learning timestamps only, never in
 * the OS clock. Calibration is cached for 30 minutes, deduplicated, and
 * scoped to immutable account ID + login token.
 *
 * Offline/unavailable server time fails open for learning, but no successful
 * calibration claim or safe auto-merge proof is fabricated.
 */
import { loadAuth } from './auth'
import { CLOCK_TOLERANCE_MS, probeEdgeClock } from './v4-clock-gate'

const MAX_CALIBRATION_AGE_MS = 30 * 60 * 1_000
const UNAVAILABLE_RETRY_MS = 60_000

export type LearnClockCalibration =
  | { status: 'not-signed-in' | 'unavailable'; measuredOffsetMs: null; appliedOffsetMs: 0 }
  | { status: 'calibrated'; measuredOffsetMs: number; appliedOffsetMs: number }

type ScopedCalibration = {
  accountId: string
  token: string
  calibratedAtMonoMs: number
  serverEpochAtMonoMs: number
  measuredOffsetMs: number
  appliedOffsetMs: number
}
let calibration: ScopedCalibration | null = null
let pending: { accountId: string; token: string; result: Promise<LearnClockCalibration> } | null = null
let unavailableUntil: { accountId: string; token: string; untilMonoMs: number } | null = null

function signedInIdentity(): { accountId: string; token: string } | null {
  if (typeof localStorage === 'undefined') return null
  // A token can be held by a local isolated account even if it is expired.
  // Do not ever use a revoked/expired account calibration for anonymous work.
  const auth = loadAuth({ preserveExpired: true })
  if (!auth?.token || !auth.user?.userId || auth.expiresAt * 1000 <= Date.now()) return null
  return { accountId: auth.user.userId, token: auth.token }
}
function sameIdentity(a: { accountId: string; token: string } | null,
  b: { accountId: string; token: string }): boolean {
  return !!a && a.accountId === b.accountId && a.token === b.token
}

export function learningClockEpochMs(): number {
  const identity = signedInIdentity()
  const current = calibration
  if (!current || !sameIdentity(identity, current) ||
      current.appliedOffsetMs === 0) {
    return Date.now()
  }
  // Keep the last trusted anchor until a successful refresh: falling back
  // when cache TTL expires would abruptly move persisted learning times.
  // Monotonic elapsed time tolerates OS changes mid-session.
  return current.serverEpochAtMonoMs +
    (performance.now() - current.calibratedAtMonoMs)
}

export async function ensureSignedInLearnClock(): Promise<LearnClockCalibration> {
  const identity = signedInIdentity()
  if (!identity) {
    calibration = null
    return { status: 'not-signed-in', measuredOffsetMs: null, appliedOffsetMs: 0 }
  }
  const monoNow = performance.now()
  if (calibration && sameIdentity(identity, calibration) &&
      monoNow - calibration.calibratedAtMonoMs < MAX_CALIBRATION_AGE_MS) {
    return { status: 'calibrated',
      measuredOffsetMs: calibration.measuredOffsetMs,
      appliedOffsetMs: calibration.appliedOffsetMs }
  }
  if (pending && sameIdentity(identity, pending)) return pending.result
  if (unavailableUntil && sameIdentity(identity, unavailableUntil) &&
      monoNow < unavailableUntil.untilMonoMs) {
    return { status: 'unavailable', measuredOffsetMs: null, appliedOffsetMs: 0 }
  }

  const run = async (): Promise<LearnClockCalibration> => {
    const measured = await probeEdgeClock()
    const stillSame = signedInIdentity()
    if (!sameIdentity(stillSame, identity)) {
      return { status: 'not-signed-in', measuredOffsetMs: null, appliedOffsetMs: 0 }
    }
    // A stable, fast clock probe can correct a wall clock outside tolerance.
    // A slow network/unstable server cannot establish a trustworthy offset.
    if ((measured.reason === 'within-tolerance' || measured.reason === 'clock-skew') &&
        measured.validSamples >= 2 && measured.offsetMs !== null &&
        Number.isFinite(measured.offsetMs)) {
      const appliedOffsetMs = Math.abs(measured.offsetMs) <= CLOCK_TOLERANCE_MS
        ? 0 : measured.offsetMs
      const calibratedAtMonoMs = performance.now()
      const serverEpochAtMonoMs = Date.now() + measured.offsetMs
      calibration = { ...identity, calibratedAtMonoMs, serverEpochAtMonoMs,
        measuredOffsetMs: measured.offsetMs, appliedOffsetMs }
      unavailableUntil = null
      return { status: 'calibrated', measuredOffsetMs: measured.offsetMs, appliedOffsetMs }
    }
    unavailableUntil = { ...identity,
      untilMonoMs: performance.now() + UNAVAILABLE_RETRY_MS }
    return { status: 'unavailable', measuredOffsetMs: null, appliedOffsetMs: 0 }
  }
  const result = run().catch((): LearnClockCalibration => {
    unavailableUntil = { ...identity,
      untilMonoMs: performance.now() + UNAVAILABLE_RETRY_MS }
    return { status: 'unavailable', measuredOffsetMs: null, appliedOffsetMs: 0 }
  }).finally(() => {
    if (pending?.result === result) pending = null
  })
  pending = { ...identity, result }
  return result
}
