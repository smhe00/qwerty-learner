import { createSerializedSnapshotWriter } from '@/review/persistence'
import type { ReviewRecord } from './record'
import { putWordReviewRecord } from './review-record'

// One queue per document, shared by UI updates and every flush consumer.
// Ownership moves here without changing snapshot/order/flush semantics.
const writer = createSerializedSnapshotWriter(putWordReviewRecord)

export function queueReviewRecordWrite(record: ReviewRecord): Promise<unknown> {
  const pending = writer.enqueue(record)
  // UI is synchronous, but failure remains observable from the original
  // promise and flush(). This observer only prevents a detached rejection.
  void pending.catch((error) => console.error('failed to persist review checkpoint', error))
  return pending
}

export async function flushReviewRecordWrites(): Promise<void> {
  await writer.flush()
}
