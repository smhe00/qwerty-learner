import MobileDailyProgress from './MobileDailyProgress'
import './mobile-app.css'
import { useMobileDailyProgress } from './useMobileDailyProgress'
import { settleLearnBlockDurably } from '@/learn/settlement'
import type { LearnBlockSettlement, LearnBlockSettlementInput } from '@/learn/settlement'
import { useConfetti } from '@/pages/Typing/hooks/useConfetti'
import { reviewModeInfoAtom } from '@/store'
import { useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

/** Local settlement only. No cloud-completion operation or cloud status belongs to this page. */
export default function MobileResult({ input }: { input: LearnBlockSettlementInput }) {
  const [settlement, setSettlement] = useState<LearnBlockSettlement | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const pending = useRef<Promise<LearnBlockSettlement> | null>(null)
  const inputRef = useRef(input)
  const setReview = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()
  const daily = useMobileDailyProgress()
  useEffect(() => {
    let active = true
    if (!pending.current) pending.current = settleLearnBlockDurably(inputRef.current)
    void pending.current
      .then((result) => {
        if (active) setSettlement(result)
      })
      .catch(() => {
        if (active) setError('学习记录还未确认完整保存，请保留此页并重试。')
      })
    return () => {
      active = false
    }
  }, [attempt])
  const ready = settlement !== null
  useConfetti(ready)
  const next = () => {
    if (!settlement) return
    setReview({ isReviewMode: false, reviewRecord: undefined })
    navigate('/mobile/study', { replace: true })
  }
  const seconds = Math.max(0, Math.floor(input.activeSeconds))
  return (
    <main className="mobile-app mobile-home" data-mobile-complete>
      <div className="mobile-home-inner">
        <section className="mobile-today mobile-result-card" aria-busy={!ready && !error}>
          <p className="mobile-eyebrow">TODAY · LEARN</p>
          <h1>
            {ready ? (settlement.progress.complete ? '今天的任务告一段落' : '本轮学习完成') : error ? '暂未完成保存' : '正在保存学习记录'}
          </h1>
          <p className="mobile-page-description" role="status">
            {ready ? '本轮学习记录已保存在本机。' : error ? '' : '正在核对本轮记录与今日进度，请稍候…'}
          </p>
          {error && (
            <div role="alert" className="mobile-local-error">
              <p>{error}</p>
              <button
                type="button"
                className="mobile-start-link"
                onClick={() => {
                  try {
                    setReview((old) => ({ ...old }))
                  } catch {
                    setError('本机存储暂时不可用，请保留此页并稍后重试。')
                    return
                  }
                  pending.current = null
                  setError('')
                  setAttempt((value) => value + 1)
                }}
              >
                重试保存
              </button>
            </div>
          )}
          {ready && (
            <>
              <dl className="mobile-round-grid">
                <div>
                  <dt>本轮练习</dt>
                  <dd>{input.sourceRecordIds.length} 次</dd>
                </div>
                <div>
                  <dt>本轮用时</dt>
                  <dd>
                    {Math.floor(seconds / 60)}分{seconds % 60}秒
                  </dd>
                </div>
              </dl>
              <h2>今日进度</h2>
              <MobileDailyProgress summary={daily} />
              {!settlement.progress.complete && (
                <button type="button" className="mobile-start-link" onClick={next}>
                  继续今日学习
                </button>
              )}
              {settlement.session.executionExhausted && <p className="mobile-page-description">未达标的单词仍保留，之后会继续巩固。</p>}
            </>
          )}
          <button type="button" className="mobile-result-back" disabled={!ready} onClick={() => navigate('/mobile')}>
            返回手机菜单
          </button>
        </section>
      </div>
    </main>
  )
}
