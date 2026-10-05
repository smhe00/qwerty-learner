export type AsyncOwnershipClaim = {
  generation: number
  isCurrent: () => boolean
  invalidate: () => void
}

export type AsyncOwnershipGuard = {
  activate: () => void
  deactivate: () => void
  begin: () => AsyncOwnershipClaim
  currentGeneration: () => number
}

export function createAsyncOwnershipGuard(): AsyncOwnershipGuard {
  let generation = 0
  let active = true

  return {
    activate() {
      active = true
    },

    deactivate() {
      active = false
      generation += 1
    },

    begin() {
      const claimGeneration = generation + 1
      generation = claimGeneration

      return {
        generation: claimGeneration,
        isCurrent: () =>
          active && generation === claimGeneration,
        invalidate: () => {
          if (generation === claimGeneration) {
            generation += 1
          }
        },
      }
    },

    currentGeneration() {
      return generation
    },
  }
}
