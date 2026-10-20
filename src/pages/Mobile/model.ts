import type { IReviewRecord } from '@/utils/db/record'
import { getFirstValidDictionaryExample, maskDictionaryExample } from '@/utils/dictionaryExample'

/** A presentation-only projection. Neither viewing nor leaving Mobile P0
 * can progress the session or emit an FSRS/word/achievement event.
 * The desktop Learn engine remains the sole owner of scoring until Mobile P1.
 */
export function pickMobileCheckpoint(
  dict: string,
  cached: IReviewRecord | undefined,
  saved: IReviewRecord[],
): IReviewRecord | null {
  const valid = (record: IReviewRecord | undefined): record is IReviewRecord =>
    !!record &&
    record.dict === dict &&
    record.isFinished === false &&
    Array.isArray(record.words) &&
    Number.isInteger(record.index) &&
    record.index >= 0 &&
    record.index < record.words.length &&
    typeof record.words[record.index]?.name === 'string' &&
    record.words[record.index].name.length > 0

  const validSaved = saved.filter(valid).sort((a, b) =>
    a.createTime - b.createTime || (a.id ?? 0) - (b.id ?? 0))
  const latest = validSaved[validSaved.length - 1]
  if (!valid(cached)) return latest ?? null
  if (!latest) return cached
  const same = cached.id !== undefined && latest.id !== undefined
    ? cached.id === latest.id
    : cached.createTime === latest.createTime
  if (same) return cached.index >= latest.index ? cached : latest
  return cached.createTime > latest.createTime ? cached : latest
}

export function mobileStudyPresentation(record: IReviewRecord | null) {
  if (!record) return null
  const word = record.words[record.index]
  const example = getFirstValidDictionaryExample(word)
  const parts = example ? maskDictionaryExample(example) : undefined
  return {
    index: record.index,
    total: record.words.length,
    /** Do not leak the spelling of an uncompleted word in read-only P0. */
    maskedWord: Array.from(word.name).map(char => /\s/.test(char) ? ' ' : '＿').join(' '),
    example: parts ? {
      before: parts.before,
      masked: parts.masked,
      after: parts.after,
      translation: example ? example.cn : '',
    } : null,
    /** Without an example, Cold Probe permits translation as semantic fallback. */
    meaningFallback: !example ? word.trans?.filter(Boolean).join('；') ?? '' : null,
  }
}
