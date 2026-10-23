import type { MobileDailySummary } from './useMobileDailyProgress'

export default function MobileDailyProgress({ summary }: { summary: MobileDailySummary }) {
  const { progress, error, retry } = summary
  if (!progress)
    return (
      <div role={error ? 'alert' : 'status'} className="mobile-daily-loading">
        {error ? (
          <>
            暂时无法加载今日计划。
            <button type="button" onClick={retry}>
              重新加载
            </button>
          </>
        ) : (
          '正在读取今日学习进度…'
        )}
      </div>
    )
  return (
    <div data-mobile-daily-progress>
      <dl className="mobile-daily-grid">
        <div>
          <dt>新词达标</dt>
          <dd>
            {progress.completedNewWords}
            <span> / {progress.newTargetWords}</span>
          </dd>
        </div>
        <div>
          <dt>今日复习</dt>
          <dd>
            {progress.completedReviewWords}
            <span> / {progress.reviewTargetWords}</span>
          </dd>
        </div>
        {progress.carryOverTargetWords > 0 && (
          <div>
            <dt>继续巩固</dt>
            <dd>
              {progress.completedCarryOverWords}
              <span> / {progress.carryOverTargetWords}</span>
            </dd>
          </div>
        )}
      </dl>
      <div
        className="mobile-daily-bar"
        role="progressbar"
        aria-label="今日目标进度"
        aria-valuemin={0}
        aria-valuemax={Math.max(1, progress.targetWords)}
        aria-valuenow={progress.completedWords}
        aria-valuetext={`${progress.completedWords} / ${progress.targetWords}`}
      >
        <span style={{ width: progress.percent + '%' }} />
      </div>
      <p className="mobile-daily-caption">
        {progress.complete ? '今日目标已完成' : `今日已达标 ${progress.completedWords} 词，还需 ${progress.remainingWords} 词`}
      </p>
    </div>
  )
}
