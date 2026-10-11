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
}

const KEY = 'qwerty.perf-diagnostics.v1'
const MAX_SAMPLES = 160
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
        (typeof sample.sizeBytes === 'number' && Number.isSafeInteger(sample.sizeBytes)))
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
