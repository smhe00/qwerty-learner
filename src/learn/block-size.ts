export const DEFAULT_LEARN_BLOCK_SIZE = 10
export const MIN_LEARN_BLOCK_SIZE = 1
export const MAX_LEARN_BLOCK_SIZE = 50

export function normalizeLearnBlockSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LEARN_BLOCK_SIZE
  return Math.min(MAX_LEARN_BLOCK_SIZE, Math.max(MIN_LEARN_BLOCK_SIZE, Math.floor(value)))
}
