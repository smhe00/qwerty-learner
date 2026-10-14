/**
 * Safe ONLY for immutable, content-addressed V4 HTTP parts.
 * Never apply this to /commit, recovery or mutable revision writes.
 */
export const V4_PART_RETRY_DELAY_MS = [0, 150, 350, 750, 1500, 3000] as const

export async function retryIdenticalV4Part<T>(
  submitIdenticalPart: () => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  pause: (ms: number) => Promise<void> =
    ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; attempt < V4_PART_RETRY_DELAY_MS.length; attempt++) {
    if (attempt !== 0) await pause(V4_PART_RETRY_DELAY_MS[attempt])
    try {
      return await submitIdenticalPart()
    } catch (error) {
      if (!isRetryable(error) || attempt + 1 === V4_PART_RETRY_DELAY_MS.length) {
        throw error
      }
    }
  }
  throw new Error('unreachable-v4-part-retry-state')
}

/**
 * Bounded parallelism is safe only for immutable V4 staging keys. A worker
 * never starts a new part after any worker fails; already in-flight requests
 * are allowed to settle. The caller MUST await this entire barrier before
 * issuing the (non-retryable) revision commit.
 */
export const V4_PART_MAX_IN_FLIGHT = 3 as const

export async function stageImmutableV4Parts<T>(
  parts: readonly T[],
  stage: (part: T) => Promise<void>,
  maxInFlight: number = V4_PART_MAX_IN_FLIGHT,
): Promise<void> {
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1 ||
      maxInFlight > V4_PART_MAX_IN_FLIGHT) {
    throw new Error('invalid-v4-stage-concurrency')
  }
  let cursor = 0
  let failed = false
  let firstError: unknown
  const worker = async () => {
    while (!failed && cursor < parts.length) {
      const part = parts[cursor++]
      try {
        await stage(part)
      } catch (error) {
        if (!failed) {
          failed = true
          firstError = error
        }
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(parts.length, maxInFlight) }, () => worker()))
  if (failed) throw firstError
}
