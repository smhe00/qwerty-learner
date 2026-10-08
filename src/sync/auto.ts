import { assertLegacyCloudMutationAllowed } from './workspace-auth-guard'
import { SyncApiError, getSyncMeta, putSync } from './api'
import { loadAuth } from './auth'
import {
  CLIENT_FORMAT_VERSION,
  createLocalSnapshot,
  inspectLocalState,
} from './snapshot'
import {
  assessSyncState,
  decideLearnAutoSyncAction,
  loadSyncBaseline,
  saveSyncBaseline,
} from './state'

export type LearnAutoSyncResult =
  | { status: 'not-logged-in' }
  | { status: 'clean' }
  | { status: 'remote-ahead' }
  | { status: 'diverged' }
  | { status: 'uploaded'; revision: number }
  | { status: 'conflict' }
  | { status: 'failed'; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Completion-only safe upload.
 *
 * Automatic sync is deliberately one-way and conservative: it uploads only
 * when local is dirty and the remote has not changed since the saved baseline.
 * Remote-ahead/diverged/conflict states never auto-overwrite cloud data.
 */
export async function autoSyncCompletedLearnSession(): Promise<LearnAutoSyncResult> {
  const auth = loadAuth()
  if (!auth) return { status: 'not-logged-in' }

  try {
    await assertLegacyCloudMutationAllowed()
    const [local, remote] = await Promise.all([
      inspectLocalState(),
      getSyncMeta(auth.token),
    ])
    const baseline = loadSyncBaseline(auth.user.userId)
    const assessment = assessSyncState(local, remote, baseline)

    const action = decideLearnAutoSyncAction(assessment)
    if (action === 'clean') return { status: 'clean' }
    if (action === 'diverged') return { status: 'diverged' }
    if (action === 'remote-ahead') {
      return { status: 'remote-ahead' }
    }

    const snapshot = await createLocalSnapshot()
    const uploaded = await putSync(auth.token, {
      baseRevision: remote.revision,
      payloadBase64: snapshot.payloadBase64,
      deviceId: 'qwerty-web-auto-learn',
      clientFormatVersion: CLIENT_FORMAT_VERSION,
    })

    saveSyncBaseline(
      auth.user.userId,
      uploaded.revision,
      snapshot.fingerprint,
    )

    return {
      status: 'uploaded',
      revision: uploaded.revision,
    }
  } catch (error) {
    if (
      error instanceof SyncApiError &&
      error.code === 'sync_conflict'
    ) {
      return { status: 'conflict' }
    }

    return {
      status: 'failed',
      message: errorMessage(error),
    }
  }
}
