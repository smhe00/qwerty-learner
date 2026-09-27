export const typingClassifierPolicy = {
  fastFirstKeyMs: 500,
  longFirstKeyMs: 1800,
  veryLongFirstKeyMs: 3000,
  fastInterKeyMs: 250,
  slowInterKeyMs: 700,
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
