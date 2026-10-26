import { getAchievementSessionId } from '@/achievement/session'
import type { WordRecordInput } from '@/learn/word-record-commit'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import { currentChapterAtom, currentDictIdAtom, isReviewModeAtom, reviewModeInfoAtom } from '@/store'
import { commitBrowserWordRecord } from '@/utils/db/word-record-commit'
import { useAtomValue } from 'jotai'
import { useCallback, useContext } from 'react'

/** React adapter: bind the current session, not record construction or IO. */
export function useWordRecordCommit() {
  const isRevision = useAtomValue(isReviewModeAtom)
  const currentChapter = useAtomValue(currentChapterAtom)
  const dict = useAtomValue(currentDictIdAtom)
  const { reviewRecord } = useAtomValue(reviewModeInfoAtom)
  const sessionId = reviewRecord ? getAchievementSessionId(reviewRecord) : undefined
  const sessionFinished = reviewRecord?.isFinished === true
  const sessionIndex = reviewRecord?.index
  const sessionQueueLength = reviewRecord?.words.length
  const { dispatch } = useContext(TypingContext) ?? {}
  return useCallback((input: WordRecordInput) => commitBrowserWordRecord(
    input,
    { dict, chapter: isRevision ? -1 : currentChapter, sessionId, sessionFinished, sessionIndex, sessionQueueLength },
    (id) => dispatch?.({ type: TypingStateActionType.ADD_WORD_RECORD_ID, payload: id }),
  ), [dict, isRevision, currentChapter, sessionId, sessionFinished, sessionIndex, sessionQueueLength, dispatch])
}
