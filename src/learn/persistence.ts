import { flushReviewRecordWrites } from '@/store/reviewInfoAtom'

const pending = new Set<Promise<unknown>>()

export function trackLearnPersistence<T>(
  promise: Promise<T>,
): Promise<T> {
  pending.add(promise)
  void promise.finally(() => pending.delete(promise))
  return promise
}

export async function flushLearnPersistence(): Promise<void> {
  // New derived writes can be scheduled while an earlier one settles, so
  // drain until the registry is empty after the serialized ReviewRecord queue.
  await flushReviewRecordWrites()

  while (pending.size > 0) {
    const batch = [...pending]
    await Promise.allSettled(batch)
    await flushReviewRecordWrites()
  }
}
