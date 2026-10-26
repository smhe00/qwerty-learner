/** Control signals created at the owning boundary, never inferred from text. */
export class WorkspaceWriterOccupiedError extends Error {
  constructor() {
    super('Another tab owns the active workspace writer lease')
    this.name = 'WorkspaceWriterOccupiedError'
  }
}

/** A staged M4 transaction must retain its journal for explicit recovery. */
export class M4RecoveryRequiredError extends Error {
  constructor(cause: unknown) {
    super('m4-merge-interrupted-recovery-required', { cause })
    this.name = 'M4RecoveryRequiredError'
  }
}
