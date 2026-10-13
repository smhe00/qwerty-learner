/**
 * Read-only, fail-closed preflight for FUTURE V4 auto-merges.
 *
 * Origin /api/health returns serverTimeMs (milliseconds UTC) and no-store.
 * Unlike the HTTP Date header (one-second resolution, may be supplied by a
 * proxy), this is measured by QWERTY's EdgeOne function at response creation.
 * This does NOT set the OS/browser clock or change historical records.
 */
export type ClockProbe = {
  sentWallMs: number
  receivedWallMs: number
  roundTripMs: number
  serverTimeMs: number
}

export type ClockGateResult = {
  trusted: boolean
  reason: 'within-tolerance' | 'insufficient-samples' |
    'slow-network' | 'unstable-clock' | 'clock-skew'
  offsetMs: number | null
  uncertaintyMs: number | null
  validSamples: number
}

const MAX_ALLOWED_SKEW_MS = 5_000
const MAX_ROUND_TRIP_MS = 1_500
const MAX_JITTER_MS = 2_000
const MIN_SAMPLE_COUNT = 2

/** Pure estimator used by tests and an eventual S1 writer-lease merge gate. */
export function evaluateEdgeClock(samples: readonly ClockProbe[]): ClockGateResult {
  const valid = samples
    .filter(p =>
      Number.isSafeInteger(p.serverTimeMs) &&
      Number.isFinite(p.sentWallMs) && Number.isFinite(p.receivedWallMs) &&
      Number.isFinite(p.roundTripMs) &&
      p.roundTripMs >= 0 && p.roundTripMs <= MAX_ROUND_TRIP_MS &&
      p.receivedWallMs >= p.sentWallMs &&
      Math.abs(p.receivedWallMs - p.sentWallMs - p.roundTripMs) <= 500,
    )
    .map(p => ({
      offset: p.serverTimeMs - (p.sentWallMs + p.roundTripMs / 2),
      uncertainty: p.roundTripMs / 2,
      roundTrip: p.roundTripMs,
    }))
    .sort((a, b) => a.roundTrip - b.roundTrip)

  if (valid.length < MIN_SAMPLE_COUNT) {
    return { trusted: false, reason: samples.length < MIN_SAMPLE_COUNT
      ? 'insufficient-samples' : 'slow-network',
    offsetMs: null, uncertaintyMs: null, validSamples: valid.length }
  }
  // Three sequential probes are collected; require all accepted observations
  // to agree. Even a fast min-RTT measurement is not independently trusted.
  const best = valid[0]
  const spread = Math.max(...valid.map(v => v.offset)) -
    Math.min(...valid.map(v => v.offset))
  if (spread > MAX_JITTER_MS) {
    return { trusted: false, reason: 'unstable-clock',
      offsetMs: best.offset, uncertaintyMs: best.uncertainty, validSamples: valid.length }
  }
  if (Math.abs(best.offset) + best.uncertainty > MAX_ALLOWED_SKEW_MS) {
    return { trusted: false, reason: 'clock-skew',
      offsetMs: best.offset, uncertaintyMs: best.uncertainty, validSamples: valid.length }
  }
  return { trusted: true, reason: 'within-tolerance',
    offsetMs: best.offset, uncertaintyMs: best.uncertainty, validSamples: valid.length }
}

/**
 * Opt-in time check: performed only immediately before planning an
 * auto-merge, never as an unconditional gate on offline learning or export.
 * No fallback to the HTTP Date header or a guessed offset.
 *
 * The serverTimeMs capability must be deployed to master first; older
 * EdgeOne responses correctly produce an untrusted result.
 */
export async function probeEdgeClock(
  endpoint = '/api/health',
  fetcher: typeof fetch = fetch,
): Promise<ClockGateResult> {
  const samples: ClockProbe[] = []
  for (let i = 0; i < 3; i++) {
    const sentWallMs = Date.now()
    const begin = performance.now()
    try {
      const response = await fetcher(endpoint, {
        method: 'GET', cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(3_000),
      })
      const json = await response.json() as { serverTimeMs?: unknown; ok?: unknown }
      const roundTripMs = performance.now() - begin
      const receivedWallMs = Date.now()
      if (!response.ok || json.ok !== true ||
        !Number.isSafeInteger(json.serverTimeMs)) continue
      samples.push({
        sentWallMs, receivedWallMs, roundTripMs,
        serverTimeMs: json.serverTimeMs as number,
      })
    } catch {
      // Unavailable EdgeOne means auto-merge stays blocked, not data loss.
    }
  }
  return evaluateEdgeClock(samples)
}
