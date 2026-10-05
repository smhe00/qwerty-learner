import { fsrs } from 'ts-fsrs'
import { FSRS_SHADOW_PARAMETER_SET_ID } from './types'

export type Fsrs6StrategyConfig = {
  id: string
  requestRetention: number
  weights?: readonly number[]
}

export const FSRS6_DEFAULT_STRATEGY: Fsrs6StrategyConfig = {
  id: FSRS_SHADOW_PARAMETER_SET_ID,
  requestRetention: 0.9,
}

export function createFsrs6Scheduler(
  strategy: Fsrs6StrategyConfig = FSRS6_DEFAULT_STRATEGY,
) {
  if (
    !Number.isFinite(strategy.requestRetention) ||
    strategy.requestRetention < 0.7 ||
    strategy.requestRetention > 0.97
  ) {
    throw new Error(
      `FSRS-6 requestRetention must be finite and within [0.70, 0.97], got ${strategy.requestRetention}`,
    )
  }

  if (
    strategy.weights !== undefined &&
    (strategy.weights.length !== 21 ||
      strategy.weights.some((weight) => !Number.isFinite(weight)))
  ) {
    throw new Error(
      'FSRS-6 custom weights must contain exactly 21 finite values',
    )
  }

  return fsrs({
    request_retention: strategy.requestRetention,
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: false,
    learning_steps: [],
    relearning_steps: [],
    ...(strategy.weights === undefined
      ? {}
      : { w: [...strategy.weights] }),
  })
}
