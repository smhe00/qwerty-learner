export const typingClassifierPolicy = {
  fastFirstKeyMs: 500,
  longFirstKeyMs: 1800,
  veryLongFirstKeyMs: 3000,
  attentionUncertainFirstKeyMs: 15000,
  attentionUncertainInterKeyMs: 15000,
  fastInterKeyMs: 250,
  slowInterKeyMs: 1200,
  motorAdjacentRatio: 0.75,
  uncertainConfidence: 0.5,
  uncertainMargin: 0.1,
} as const

export const reinforcementGapByCause = {
  recall: 3,
  spelling: 4,
  uncertain: 5,
  motor: 7,
} as const


export const basicReviewIntervalsDays = [1, 3, 7, 14, 30] as const
export const sameSessionWindowSeconds = 30 * 60
