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
