import type { LearnBlockSettlement } from './settlement'

/** Presentation only: never evidence for progress, ownership, or a cloud write. */
export type LearnResultSummary = {
  dictionary: string
  title: string
  description: string
  percent: number
  progressLabel: string
  metrics: { label: string; value: string; detail: string }[]
}

export function learnResultSummary(settlement: LearnBlockSettlement, dictionary: string, extraRound: boolean): LearnResultSummary {
  const { progress: p, session } = settlement
  const milestoneIndex =
    settlement.milestoneReached === undefined ? -1 : (session.blockMilestones ?? []).indexOf(settlement.milestoneReached)
  const seconds = Math.max(0, Math.floor(session.accumulatedActiveSeconds))
  return {
    dictionary,
    title: p.complete
      ? extraRound
        ? '本次加学完成'
        : '今日学习完成'
      : session.executionExhausted
      ? '本轮练习已结束'
      : milestoneIndex >= 0
      ? '阶段 ' + (milestoneIndex + 1) + ' 完成'
      : session.blockMilestones
      ? '继续学习'
      : '阶段完成',
    description:
      session.executionExhausted && !p.complete
        ? '本轮练习已结束。需巩固的词仍然保留，不会计为已掌握。'
        : p.complete
        ? extraRound
          ? '本轮练习已完成，需巩固的词已保留。'
          : '今日练习已完成。需巩固的词已记下，系统会继续安排复习。'
        : '今天已经完成 ' + p.percent + '%。当前阶段学习记录已保存在本机。',
    percent: p.percent,
    progressLabel: extraRound ? '本轮学习完成进度' : '今日学习完成进度',
    metrics: [
      { label: extraRound ? '本轮进度' : '今日进度', value: p.completedWords + '/' + p.targetWords, detail: p.percent + '%' },
      {
        label: extraRound ? '本轮新词' : '今日新词',
        value: p.introducedNewWords + '/' + p.newTargetWords,
        detail: '独立完成 ' + p.completedNewWords,
      },
      {
        label: extraRound ? '本轮复习完成' : '复习已完成',
        value: p.completedReviewWords + '/' + p.reviewTargetWords,
        detail: '独立答对 ' + p.independentReviewWords + ' 词',
      },
      { label: '复习需巩固', value: String(p.reviewWordsToConsolidate), detail: '已记下，之后继续安排复习' },
      { label: '待完成', value: String(p.remainingWords), detail: '词' },
      {
        label: '学习时间',
        value: String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'),
        detail: '',
      },
    ],
  }
}

/** Invalid optional display data must not invalidate an otherwise valid sync intent. */
export function readLearnResultSummary(value: unknown): LearnResultSummary | undefined {
  if (!value || typeof value !== 'object') return
  const v = value as Partial<LearnResultSummary>
  const text = (s: unknown): s is string => typeof s === 'string' && s.length <= 200
  if (
    !text(v.dictionary) ||
    !text(v.title) ||
    !text(v.description) ||
    !text(v.progressLabel) ||
    typeof v.percent !== 'number' ||
    !Number.isFinite(v.percent) ||
    v.percent < 0 ||
    v.percent > 100 ||
    !Array.isArray(v.metrics) ||
    v.metrics.length !== 6 ||
    !v.metrics.every((m) => m && text(m.label) && text(m.value) && text(m.detail))
  )
    return
  return {
    dictionary: v.dictionary,
    title: v.title,
    description: v.description,
    percent: v.percent,
    progressLabel: v.progressLabel,
    metrics: v.metrics.map(({ label, value, detail }) => ({ label, value, detail })),
  }
}
