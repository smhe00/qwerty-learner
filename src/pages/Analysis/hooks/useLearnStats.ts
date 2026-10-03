import { buildLearnStatsSnapshot } from '@/learn/stats'
import type { LearnStatsSnapshot } from '@/learn/stats'
import { analyzeFsrsShadowRecords } from '@/review/fsrs/analysis'
import type { FsrsG3AnalysisV1 } from '@/review/fsrs/analysis'
import { db } from '@/utils/db'
import { wordListFetcher } from '@/utils/wordListFetcher'
import { useEffect, useState } from 'react'

export type LearnStatsLoadState = {
  stats?: LearnStatsSnapshot
  fsrsAnalysis?: FsrsG3AnalysisV1
  loading: boolean
  wordListAvailable: boolean
  error?: string
}

export function useLearnStats(
  dict: string,
  dictUrl: string,
): LearnStatsLoadState {
  const [state, setState] = useState<LearnStatsLoadState>({
    loading: true,
    wordListAvailable: true,
  })

  useEffect(() => {
    let active = true

    const load = async () => {
      setState((current) => ({ ...current, loading: true, error: undefined }))

      try {
        const [wordRecords, wordStates, wordListResult] = await Promise.all([
          db.wordRecords.where('dict').equals(dict).toArray(),
          db.reviewWordStates.where('dict').equals(dict).toArray(),
          wordListFetcher(dictUrl)
            .then((words) => ({ words, available: true as const }))
            .catch(() => ({ words: undefined, available: false as const })),
        ])

        if (!active) return

        const now = Math.floor(Date.now() / 1000)
        setState({
          loading: false,
          wordListAvailable: wordListResult.available,
          fsrsAnalysis: analyzeFsrsShadowRecords({
            records: wordRecords,
            asOf: now,
          }),
          stats: buildLearnStatsSnapshot({
            now,
            dict,
            wordRecords,
            wordStates,
            dictionaryWords: wordListResult.words?.map((word) => word.name),
          }),
        })
      } catch (error) {
        if (!active) return
        setState({
          loading: false,
          wordListAvailable: false,
          error:
            error instanceof Error
              ? error.message
              : 'Learn 统计数据加载失败',
        })
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [dict, dictUrl])

  return state
}
