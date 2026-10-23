import { createLearnDailySession, deriveLearnDailyProgress, learnLocalDateKey, loadLearnDailySession } from '@/learn/daily-session'
import { currentDictInfoAtom, memoryConfigAtom } from '@/store'
import { db } from '@/utils/db/core'
import { wordListFetcher } from '@/utils/wordListFetcher'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import useSWR from 'swr'

/** Read-only preview of the same frozen daily cohort used by Learn. No session is created/saved here. */
export function useMobileDailyProgress() {
  const dictionary = useAtomValue(currentDictInfoAtom)
  const config = useAtomValue(memoryConfigAtom)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000)
    return () => window.clearInterval(interval)
  }, [])
  const { data: words, error: dictionaryError, mutate } = useSWR(dictionary.url, wordListFetcher, { revalidateOnFocus: false })
  const [readAttempt, setReadAttempt] = useState(0)
  const local = useLiveQuery(async () => {
    try {
      const [records, states] = await Promise.all([
        db.wordRecords.where('dict').equals(dictionary.id).toArray(),
        db.reviewWordStates.where('dict').equals(dictionary.id).toArray(),
      ])
      return { records, states, error: null }
    } catch (error) {
      return { records: [], states: [], error }
    }
  }, [dictionary.id, readAttempt])
  const stored = loadLearnDailySession(dictionary.id)
  const frozen = stored?.dateKey === learnLocalDateKey(now) ? stored : null
  const session =
    frozen ??
    (words && local && !local.error
      ? createLearnDailySession({
          dict: dictionary.id,
          now,
          dailyNewTarget: config.dailyNewWordTarget,
          dictionaryWords: words.map((word) => word.name),
          wordRecords: local.records,
          wordStates: local.states,
        })
      : null)
  const progress = session && local && !local.error ? deriveLearnDailyProgress({ session, wordRecords: local.records }) : null
  const error = dictionaryError || local?.error
  return {
    progress,
    session,
    frozen: Boolean(frozen),
    loading: !progress && !error,
    error,
    retry: () => {
      setReadAttempt((value) => value + 1)
      void mutate()
    },
  }
}

export type MobileDailySummary = ReturnType<typeof useMobileDailyProgress>
