import type { IReviewRecord } from '@/utils/db/record'

export function getAchievementSessionId(
  record: Pick<IReviewRecord, 'id' | 'dict' | 'createTime'>,
): string {
  return record.id !== undefined
    ? `review:${record.id}`
    : `review:${record.dict}:${record.createTime}`
}
