import { mountGuardedWorkspaceApp as mountWithOutcome } from '../../src/sync/workspace-bootstrap'
import type { WorkspaceReloadReason } from '../../src/sync/workspace-boot-outcome'

// Keep the pre-refactor browser safety assertions intact while the product
// and new protocol tests consume explicit outcomes. This adapter is test-only.
const previousReloadDiagnostic: Record<WorkspaceReloadReason, string> = {
  's1-recovered': 'S1 recovery completed; reload required before mounting app',
  's2-pull-staged': 'S2 Pull staged; reload required before mounting app',
  's2-pull-recovered': 'S2 Pull recovery completed; reload required before mounting app',
  'manual-v4-recovered': 'Manual V4 import recovery completed; reload required before mounting app',
  'm4-recovered': 'M4 merge recovery completed; reload required before mounting app',
}

export async function mountGuardedWorkspaceApp(...args: Parameters<typeof mountWithOutcome>) {
  const outcome = await mountWithOutcome(...args)
  if (outcome.kind === 'ready') return outcome.boot
  if (outcome.kind === 'reload-required') throw new Error(previousReloadDiagnostic[outcome.reason])
  throw outcome.error
}
