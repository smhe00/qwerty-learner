import type { Word } from '@/typings'
import { timePerfStage } from '@/sync/perf-diagnostics'

export async function wordListFetcher(url: string): Promise<Word[]> {
  const URL_PREFIX: string =
    REACT_APP_DEPLOY_ENV === 'pages' ? '/qwerty-learner' : ''

  const response = await timePerfStage('startup', 'dictionary-fetch', () =>
    fetch(URL_PREFIX + url))
  if (!response.ok) {
    throw new Error(
      `Failed to load word list: ${response.status} ${response.statusText}`,
    )
  }

  const words: unknown = await timePerfStage('startup', 'dictionary-json-parse', () =>
    response.json())
  if (!Array.isArray(words)) {
    throw new Error('Invalid word list payload')
  }

  return words as Word[]
}
