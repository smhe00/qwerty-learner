/**
 * Privacy-safe, session-scoped startup and Sync V4 performance diagnostics.
 * Keeps ONLY fixed stage names, durations and byte counts; never data rows,
 * credentials, account identities, URLs, or learning content.
 *
 * The small bounded log survives full-page navigations in the same tab.
 * Diagnostics must never interfere with boot, sync or a crash-recovery path.
 */
export type PerfFlow = 'startup' | 'sync' | 'learn'
export type PerfSample = {
  at: string
  flow: PerfFlow
  stage: string
  elapsedMs?: number
  sizeBytes?: number
  partIndex?: number
  attempt?: number
  outcome?: 'ok' | 'failed'
  failureStage?: 'http_request' | 'blob_write' | 'blob_readback' |
    'part_lookup' | 'commit_core' | 'receipt'
  failureCategory?: 'network_timeout' | 'network_failure' | 'blob_storage' |
    'server_failure' | 'http_failure' | 'invalid_receipt'
  httpStatus?: number
  blobWriteMs?: number
  blobReadbackMs?: number
  partsReadMs?: number
  commitCoreMs?: number
  cleanupMs?: number
  serverTotalMs?: number
}

const KEY = 'qwerty.perf-diagnostics.v1'
const MAX_SAMPLES = 768
const MAX_STAGE_LENGTH = 64

function store(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function readPerfSamples(): PerfSample[] {
  try {
    const raw = store()?.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((sample): sample is PerfSample => (
      sample !== null && typeof sample === 'object' &&
      typeof sample.at === 'string' &&
      ['startup', 'sync', 'learn'].includes(sample.flow) &&
      typeof sample.stage === 'string' &&
      sample.stage.length <= MAX_STAGE_LENGTH &&
      (sample.elapsedMs === undefined ||
        (typeof sample.elapsedMs === 'number' && Number.isFinite(sample.elapsedMs))) &&
      (sample.sizeBytes === undefined ||
        (typeof sample.sizeBytes === 'number' && Number.isSafeInteger(sample.sizeBytes))) &&
      /^[a-z0-9.-]+$/.test(sample.stage) &&
      (sample.partIndex === undefined || (Number.isSafeInteger(sample.partIndex) &&
        sample.partIndex >= 0 && sample.partIndex < 192)) &&
      (sample.attempt === undefined || (Number.isSafeInteger(sample.attempt) &&
        sample.attempt >= 1 && sample.attempt <= 6)) &&
      (sample.outcome === undefined || ['ok', 'failed'].includes(sample.outcome)) &&
      (sample.failureStage === undefined || ['http_request', 'blob_write',
        'blob_readback', 'part_lookup', 'commit_core', 'receipt'].includes(sample.failureStage)) &&
      (sample.failureCategory === undefined || ['network_timeout', 'network_failure',
        'blob_storage', 'server_failure', 'http_failure',
        'invalid_receipt'].includes(sample.failureCategory)) &&
      (sample.httpStatus === undefined || (Number.isInteger(sample.httpStatus) &&
        sample.httpStatus >= 0 && sample.httpStatus <= 599)) &&
      ['blobWriteMs','blobReadbackMs','partsReadMs','commitCoreMs',
        'cleanupMs','serverTotalMs'].every(key => sample[key] === undefined ||
        (typeof sample[key] === 'number' && Number.isFinite(sample[key]) &&
          sample[key] >= 0 && sample[key] <= 600000))
    )).slice(-MAX_SAMPLES)
  } catch {
    return []
  }
}

export function clearPerfSamples(): void {
  try { store()?.removeItem(KEY) } catch { /* diagnostic only */ }
}

function append(sample: PerfSample): void {
  try {
    if (sample.stage.length > MAX_STAGE_LENGTH || !/^[a-z0-9.-]+$/.test(sample.stage)) return
    const storage = store()
    if (!storage) return
    const samples = readPerfSamples()
    samples.push(sample)
    storage.setItem(KEY, JSON.stringify(samples.slice(-MAX_SAMPLES)))
  } catch { /* never block a user operation on diagnostics */ }
}

function clock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function startPerfStage(flow: PerfFlow, stage: string): () => void {
  const started = clock()
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const elapsed = clock() - started
    if (!Number.isFinite(elapsed) || elapsed < 0) return
    append({ at: new Date().toISOString(), flow, stage,
      elapsedMs: Math.round(elapsed * 10) / 10 })
  }
}

export async function timePerfStage<T>(
  flow: PerfFlow, stage: string, task: () => Promise<T>,
): Promise<T> {
  const stop = startPerfStage(flow, stage)
  try { return await task() } finally { stop() }
}

export function recordPerfSize(flow: PerfFlow, stage: string, bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return
  append({ at: new Date().toISOString(), flow, stage, sizeBytes: bytes })
}

/** Redacted per-HTTP-part evidence; all names are fixed enums and the caller
 * cannot pass payloads, identifiers, tokens, URLs or exception messages.
 * Server duration fields come from the authenticated Maker response, not
 * from guessed network/Blob attribution.
 */
export function recordV4TransportSample(sample: Omit<PerfSample, 'at' | 'flow'>): void {
  if (sample.stage !== 'v4-part' && sample.stage !== 'v4-commit') return
  const fixed: PerfSample = { at: new Date().toISOString(),
    flow: 'sync', stage: sample.stage }
  for (const key of ['elapsedMs', 'blobWriteMs', 'blobReadbackMs', 'partsReadMs',
    'commitCoreMs', 'cleanupMs', 'serverTotalMs'] as const) {
    const value = sample[key]
    if (typeof value === 'number' && Number.isFinite(value) &&
        value >= 0 && value <= 600000) fixed[key] = Math.round(value * 10) / 10
  }
  if (Number.isSafeInteger(sample.partIndex) && sample.partIndex! >= 0 &&
      sample.partIndex! < 192) fixed.partIndex = sample.partIndex
  if (Number.isSafeInteger(sample.attempt) && sample.attempt! >= 1 &&
      sample.attempt! <= 6) fixed.attempt = sample.attempt
  if (Number.isSafeInteger(sample.sizeBytes) && sample.sizeBytes! >= 0) {
    fixed.sizeBytes = sample.sizeBytes
  }
  if (Number.isSafeInteger(sample.httpStatus) && sample.httpStatus! >= 0 &&
      sample.httpStatus! <= 599) fixed.httpStatus = sample.httpStatus
  if (sample.outcome === 'ok' || sample.outcome === 'failed') fixed.outcome = sample.outcome
  if (sample.failureStage && ['http_request', 'blob_write', 'blob_readback',
    'part_lookup', 'commit_core', 'receipt'].includes(sample.failureStage)) {
    fixed.failureStage = sample.failureStage
  }
  if (sample.failureCategory && ['network_timeout', 'network_failure',
    'blob_storage', 'server_failure', 'http_failure',
    'invalid_receipt'].includes(sample.failureCategory)) {
    fixed.failureCategory = sample.failureCategory
  }
  append(fixed)
}
