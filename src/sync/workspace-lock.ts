/**
 * S1 opt-in single-writer tab lease.
 *
 * All future entry points to the working RecordDB MUST acquire and keep this
 * lease for the entire mounted app lifetime BEFORE React/DB hydration. A
 * background tab which cannot obtain it must not mount the app or write to DB.
 * This module is not wired into V1 bootstrap; capability remains disabled.
 */
export type WorkingDbLease = { release(): void }
export const WORKING_DB_LOCK = 'qwerty-plus.s1.working-db-writer'

export async function acquireWorkspaceWriterLease(): Promise<WorkingDbLease> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    throw new Error('Web Locks API unavailable: S1 writer ownership refused')
  }
  let releaseHold: (() => void) | undefined
  const hold = new Promise<void>(resolve => { releaseHold = resolve })
  let resolved = false

  return new Promise<WorkingDbLease>((resolve, reject) => {
    void navigator.locks.request(
      WORKING_DB_LOCK,
      { mode: 'exclusive', ifAvailable: true },
      async lock => {
        if (!lock) {
          resolved = true
          reject(new Error('Another tab owns the active workspace writer lease'))
          return
        }
        let released = false
        resolved = true
        resolve({
          release: () => {
            if (released) return
            released = true
            releaseHold?.()
          },
        })
        await hold
      },
    ).catch(error => {
      if (!resolved) reject(error)
    })
  })
}
