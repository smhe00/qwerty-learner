import MobilePageFrame from './MobilePageFrame'
import './mobile-completion.css'
import { formatHistoryTime, summarizeMobileHistory } from './mobile-history'
import type { HistoryDay, HistoryPeriod } from './mobile-history'
import { catalogDictionaries } from '@/resources/dictionaryCatalog'
import { db } from '@/utils/db/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'

const dictionaryName = (id: string) => catalogDictionaries.find((dict) => dict.id === id)?.name ?? id

function DailyHistory({ day }: { day: HistoryDay }) {
  const [limit, setLimit] = useState(30)
  return (
    <details className="mobile-history-day" data-history-day={day.date}>
      <summary>
        <span>
          <strong>{day.date}</strong>
          <small>
            {day.words.length} 个单词 · {day.reviews} 次复习
          </small>
        </span>
        <span className="mobile-history-day-count">{day.attempts} 次练习</span>
      </summary>
      <div className="mobile-history-day-body">
        <p className="mobile-page-description">记录用时：{day.timedAttempts ? formatHistoryTime(day.recordedMs) : '暂无计时记录'}</p>
        <ul className="mobile-history-words">
          {day.words.slice(0, limit).map((word) => (
            <li key={JSON.stringify([word.dict, word.word])}>
              <span>
                <strong>{word.word}</strong>
                <small>{dictionaryName(word.dict)}</small>
              </span>
              <span>
                {word.attempts} 次{word.reviews > 0 ? ' · 复习 ' + word.reviews + ' 次' : ''}
              </span>
            </li>
          ))}
        </ul>
        {day.words.length > limit && (
          <button type="button" className="mobile-secondary-action" onClick={() => setLimit((value) => value + 30)}>
            显示更多单词
          </button>
        )}
      </div>
    </details>
  )
}

export default function MobileHistory() {
  const [period, setPeriod] = useState<HistoryPeriod>(7)
  const [dictionary, setDictionary] = useState('')
  const [limit, setLimit] = useState(14)
  const [retry, setRetry] = useState(0)
  const [now, setNow] = useState(Date.now)
  // Re-evaluate calendar boundaries when a page is left open overnight.
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  const result = useLiveQuery(async () => {
    try {
      // Raw active-workspace rows only. Never read other accounts' vaults or
      // repair/backfill old records while presenting statistics.
      return { rows: await db.wordRecords.toCollection().raw().toArray(), error: false }
    } catch {
      return { rows: [], error: true }
    }
  }, [retry])
  const dictionaries = useMemo(
    () => Array.from(new Set((result?.rows ?? []).map((row) => row.dict).filter((id) => typeof id === 'string' && id))).sort(),
    [result],
  )
  const summary = useMemo(() => summarizeMobileHistory(result?.rows ?? [], { period, dictionary, now }), [result, period, dictionary, now])
  return (
    <MobilePageFrame title="学习记录">
      <div data-mobile-history>
        <div className="mobile-history-filters">
          <label>
            时间范围
            <select
              aria-label="记录时间范围"
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value === 'all' ? 'all' : (Number(event.target.value) as 7 | 30))
                setLimit(14)
              }}
            >
              <option value={7}>最近 7 天</option>
              <option value={30}>最近 30 天</option>
              <option value="all">全部记录</option>
            </select>
          </label>
          <label>
            词库
            <select
              aria-label="记录词库"
              value={dictionary}
              onChange={(event) => {
                setDictionary(event.target.value)
                setLimit(14)
              }}
            >
              <option value="">全部词库</option>
              {dictionaries.map((id) => (
                <option value={id} key={id}>
                  {dictionaryName(id)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!result ? (
          <p role="status">正在读取学习记录…</p>
        ) : result.error ? (
          <div role="alert" className="mobile-local-error">
            暂时无法读取学习记录，原数据未修改。
            <button type="button" className="mobile-secondary-action" onClick={() => setRetry((value) => value + 1)}>
              重新读取
            </button>
          </div>
        ) : (
          <>
            <dl className="mobile-history-summary" aria-label="所选范围统计">
              <div>
                <dt>练习次数</dt>
                <dd data-history-attempts>{summary.attempts}</dd>
              </div>
              <div>
                <dt>练过的词</dt>
                <dd data-history-words>{summary.uniqueWords}</dd>
              </div>
              <div>
                <dt>复习次数</dt>
                <dd data-history-reviews>{summary.reviews}</dd>
              </div>
              <div>
                <dt>学习天数</dt>
                <dd data-history-days>{summary.activeDays}</dd>
              </div>
            </dl>
            <p className="mobile-page-description">
              记录用时：{summary.timedAttempts ? formatHistoryTime(summary.recordedMs) : '暂无计时记录'}
            </p>
            <details className="mobile-history-definition">
              <summary>统计说明</summary>
              <p>练习次数按每次作答统计；同一词库中的单词不重复计数，不代表已掌握。复习次数只计算复习练习。用时仅计算已记录的作答时间。</p>
              {summary.invalidRows > 0 && (
                <p role="status" className="mobile-page-description">
                  有 {summary.invalidRows} 条历史记录缺少有效日期或单词信息，未计入统计；原记录保留。
                </p>
              )}
            </details>
            {summary.days.length === 0 ? (
              <p className="mobile-empty-message" role="status">
                所选范围暂无学习记录。
              </p>
            ) : (
              <section aria-label="每日学习明细" className="mobile-history-list">
                {summary.days.slice(0, limit).map((day) => (
                  <DailyHistory key={day.date + ':' + dictionary + ':' + period} day={day} />
                ))}
                {summary.days.length > limit && (
                  <button type="button" className="mobile-secondary-action" onClick={() => setLimit((value) => value + 14)}>
                    显示更早记录
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </MobilePageFrame>
  )
}
