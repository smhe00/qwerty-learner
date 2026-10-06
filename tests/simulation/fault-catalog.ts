export const P2_FAULT_CATALOG_VERSION = 2 as const

export type VerificationDetectorLayer =
  | 'simulation'
  | 'formal'
  | 'browser'
  | 'p0-replay'
  | 'domain'

export type FaultCoverageStatus =
  | 'covered'
  | 'partial'
  | 'uncovered'
  | 'out-of-scope'

export type CriticalFaultCatalogEntry = {
  id: string
  family:
    | 'terminal-persistence'
    | 'mixed-identity'
    | 'candidate-budget'
    | 'async-browser'
    | 'persistence-order'
  severity: 'high' | 'medium'
  status: FaultCoverageStatus
  detectors: VerificationDetectorLayer[]
  executableMutation: boolean
  rationale: string
}

export const P2_MUTATION_POLICY = {
  minExecutableCriticalFaults: 18,
  requiredCriticalKillRate: 1,
  maxCleanFalsePositives: 0,
} as const

export const P2_CRITICAL_FAULT_CATALOG: CriticalFaultCatalogEntry[] = [
  {
    id: 'repeated-singleton-selection',
    family: 'candidate-budget',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Repeated one-word acquisition sessions despite remaining unseen work.',
  },
  {
    id: 'dropped-controller-projection',
    family: 'terminal-persistence',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Controller resolution is computed but the driver drops the resulting projection.',
  },
  {
    id: 'success-without-semantic-progress',
    family: 'terminal-persistence',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'A successful attempt leaves index, queue and item state unchanged.',
  },
  {
    id: 'stale-checkpoint-rollback',
    family: 'persistence-order',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Restore rolls an active session back to an older durable checkpoint.',
  },
  {
    id: 'finished-checkpoint-resurrection',
    family: 'terminal-persistence',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'p0-replay'],
    executableMutation: true,
    rationale: 'A terminal checkpoint is restored as unfinished.',
  },
  {
    id: 'due-review-bypassed',
    family: 'candidate-budget',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Acquisition is selected while due Review priority is violated.',
  },
  {
    id: 'final-word-durable-without-ui-finish',
    family: 'terminal-persistence',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'browser', 'p0-replay'],
    executableMutation: true,
    rationale: 'The final durable word never hands off to terminal UI state.',
  },
  {
    id: 'stale-audio-owner',
    family: 'async-browser',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal', 'browser'],
    executableMutation: true,
    rationale: 'Playback belongs to an older word/render owner.',
  },
  {
    id: 'success-advance-before-audio-settles',
    family: 'async-browser',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal', 'browser'],
    executableMutation: true,
    rationale: 'Automatic advance occurs while required success audio is unsettled.',
  },
  {
    id: 'finished-session-route-resurrection',
    family: 'terminal-persistence',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'browser', 'p0-replay'],
    executableMutation: true,
    rationale: 'Route/reload lifecycle reactivates an already finished Learn session.',
  },
  {
    id: 'post-finish-evidence',
    family: 'terminal-persistence',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'browser', 'p0-replay'],
    executableMutation: true,
    rationale: 'New Learn evidence is accepted after terminal immutability.',
  },
  {
    id: 'wrong-mixed-item-ownership',
    family: 'mixed-identity',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'domain'],
    executableMutation: true,
    rationale: 'An Acquisition word is routed through Review ownership or vice versa.',
  },
  {
    id: 'duplicate-logical-state-for-repeated-occurrence',
    family: 'mixed-identity',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation'],
    executableMutation: true,
    rationale: 'Repeated queue occurrences incorrectly create multiple logical states.',
  },
  {
    id: 'persistence-commit-before-request',
    family: 'persistence-order',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation'],
    executableMutation: true,
    rationale: 'A durable persistence completion appears before its request.',
  },
  {
    id: 'persistence-out-of-order-commit',
    family: 'persistence-order',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation'],
    executableMutation: true,
    rationale: 'An older persistence completion arrives after a newer durable completion.',
  },
  {
    id: 'stranded-deferred-acquisition',
    family: 'candidate-budget',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Deferred Acquisition has no valid path/time to resume.',
  },
  {
    id: 'pending-as-fresh',
    family: 'candidate-budget',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Pending acquisition work is charged/selected as fresh work.',
  },
  {
    id: 'admitted-as-fresh',
    family: 'candidate-budget',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'An already admitted logical word re-enters fresh Acquisition.',
  },
  {
    id: 'excluded-word-selected',
    family: 'candidate-budget',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'A manually excluded word leaks back into selection.',
  },
  {
    id: 'duplicate-canonical-selection',
    family: 'mixed-identity',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'The same logical word is selected twice in one candidate set.',
  },
  {
    id: 'fresh-selection-over-budget',
    family: 'candidate-budget',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Selected fresh words exceed the planner-approved allowance.',
  },
  {
    id: 'pending-consumes-fresh-budget',
    family: 'candidate-budget',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Ready pending work incorrectly consumes the fresh-word allowance.',
  },
  {
    id: 'quota-ignores-unseen-cap',
    family: 'candidate-budget',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Fresh allowance exceeds the remaining unseen population.',
  },
  {
    id: 'acquired-vs-introduced-quota-accounting',
    family: 'candidate-budget',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Daily quota is decremented by acquired rather than introduced words.',
  },
  {
    id: 'finished-shadows-unfinished',
    family: 'terminal-persistence',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'A newer finished row hides older recoverable unfinished work.',
  },
  {
    id: 'oldest-unfinished-restored',
    family: 'persistence-order',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Session arbitration restores an older unfinished checkpoint rather than the newest.',
  },
  {
    id: 'wrong-dictionary-restored',
    family: 'persistence-order',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Session arbitration restores unfinished work from another dictionary.',
  },
  {
    id: 'waiting-despite-unfinished',
    family: 'terminal-persistence',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'formal'],
    executableMutation: true,
    rationale: 'Controller reports waiting even though recoverable unfinished work exists.',
  },

  {
    id: 'pure-review-over-20-wrongly-rotated',
    family: 'mixed-identity',
    severity: 'high',
    status: 'covered',
    detectors: ['domain', 'p0-replay'],
    executableMutation: false,
    rationale: 'Review volume is legal above 20 and must not be classified as an oversized Acquisition cohort.',
  },
  {
    id: 'mixed-total-counted-as-acquisition-cohort',
    family: 'mixed-identity',
    severity: 'high',
    status: 'covered',
    detectors: ['domain', 'p0-replay', 'simulation'],
    executableMutation: false,
    rationale: 'Mixed-session cohort sizing must count Acquisition logical words rather than total Review+Acquisition queue size.',
  },
  {
    id: 'legacy-mixed-missing-itemKinds',
    family: 'mixed-identity',
    severity: 'high',
    status: 'covered',
    detectors: ['domain', 'simulation'],
    executableMutation: false,
    rationale: 'Legacy mixed checkpoints recover Acquisition ownership from acquisitionStates when itemKinds metadata is absent.',
  },
  {
    id: 'workload-soft-budget-ignored',
    family: 'candidate-budget',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation'],
    executableMutation: true,
    rationale: 'Fresh allowance must respect the production daily workload planner, not merely the raw quota/unseen cap.',
  },

  // Browser/P0 critical classes that are covered, but are deliberately not
  // counted as event-level simulation mutations in the kill-rate denominator.
  {
    id: 'howl-not-ready-loses-success-audio',
    family: 'async-browser',
    severity: 'high',
    status: 'covered',
    detectors: ['browser'],
    executableMutation: false,
    rationale: 'A Howl object exists before ready and must fall back to native playback.',
  },
  {
    id: 'audio-cleanup-stops-new-owner',
    family: 'async-browser',
    severity: 'high',
    status: 'covered',
    detectors: ['browser', 'formal'],
    executableMutation: false,
    rationale: 'Cleanup from an older render stops playback owned by the new render.',
  },
  {
    id: 'desktop-resize-forces-root-reload',
    family: 'async-browser',
    severity: 'high',
    status: 'covered',
    detectors: ['browser', 'simulation'],
    executableMutation: false,
    rationale: 'Desktop resize/DevTools must not navigate through root and resurrect terminal state.',
  },
  {
    id: 'background-focus-resets-statistics',
    family: 'async-browser',
    severity: 'high',
    status: 'covered',
    detectors: ['browser'],
    executableMutation: false,
    rationale: 'Blur/focus lifecycle must not reset accumulated Typing statistics.',
  },
  {
    id: 'incident-export-replay-contract-break',
    family: 'persistence-order',
    severity: 'high',
    status: 'covered',
    detectors: ['browser', 'p0-replay'],
    executableMutation: false,
    rationale: 'The one-click Incident export must remain directly consumable by P0 replay.',
  },
  {
    id: 'terminal-ui-divergence-field-incident',
    family: 'terminal-persistence',
    severity: 'high',
    status: 'covered',
    detectors: ['p0-replay', 'browser', 'simulation'],
    executableMutation: false,
    rationale: 'Durable terminal state plus finish dispatch contradicts a captured active-word DOM.',
  },

  // Browser lifecycle classes closed by P3. They remain outside the
  // event-level simulation mutation denominator because their detector is
  // real Playwright/React/browser behavior.
  {
    id: 'stale-async-preparation-wins-navigation',
    family: 'async-browser',
    severity: 'high',
    status: 'covered',
    detectors: ['browser', 'domain'],
    executableMutation: false,
    rationale: 'P3 deterministically blocks Learn preparation, leaves the SPA route, releases the stale operation, and requires the injected stale-owner mutant to be detected.',
  },
  {
    id: 'route-cache-idb-divergence-after-crash',
    family: 'persistence-order',
    severity: 'high',
    status: 'covered',
    detectors: ['p0-replay', 'browser'],
    executableMutation: false,
    rationale: 'P3 creates a controlled route-cache-ahead-of-IndexedDB window, reloads the document before the blocked durable write, and verifies route-cache recovery plus forward convergence.',
  },
  {
    id: 'refresh-during-checkpoint-commit-window',
    family: 'persistence-order',
    severity: 'high',
    status: 'covered',
    detectors: ['simulation', 'browser'],
    executableMutation: false,
    rationale: 'P3 blocks the real checkpoint persistence path, refreshes during the window, restores from route-critical cache, releases persistence, and verifies monotonic convergence.',
  },
  {
    id: 'viewport-resize-without-document-reload',
    family: 'async-browser',
    severity: 'medium',
    status: 'covered',
    detectors: ['browser'],
    executableMutation: false,
    rationale: 'P3 includes viewport resize as an independent seeded action and kills an injected desktop-resize navigation mutant.',
  },
]
